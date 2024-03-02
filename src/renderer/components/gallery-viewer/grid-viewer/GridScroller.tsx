import type { StyleSheet } from 'jss';
import { orderBy, size, some, values } from 'lodash';
import natsort from 'natsort';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createUseStyles, jss } from 'react-jss';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { Grid, GridCellProps } from 'react-virtualized';
import { useDebouncedCallback } from 'use-debounce';

import { THUMBNAIL_HEIGHT, THUMBNAIL_SIZE } from 'renderer/components/gallery-viewer/grid-viewer/GridFolderThumbnail';
import GridThumbnail from 'renderer/components/gallery-viewer/grid-viewer/GridThumbnail';
import useAutomaticChildrenLoader from 'renderer/hooks/useAutomaticChildrenLoader';
import useEventListener from 'renderer/hooks/useEventListener';
import useSelectedFolder from 'renderer/hooks/useSelectedFolder';
import useSelectedIndex from 'renderer/hooks/useSelectedIndex';
import { openFolder } from 'renderer/redux/slices/folderVisibilitySlice';
import { selectGallerySort, setFilesCount } from 'renderer/redux/slices/galleryViewerSlice';
import { selectSelectedFile, setSelectedFile } from 'renderer/redux/slices/selectedFolderSlice';
import { selectPlaying, selectPreview, setPreview } from 'renderer/redux/slices/viewerSlice';
import animate from 'renderer/utils/animate';

type ExtendedGrid = Grid & { _scrollingContainer: HTMLDivElement };

const useStyles = createUseStyles({
  grid: {},
});

type Props = {
  width: number;
  height: number;
};

export default function GridScroller({ width, height }: Props) {
  const classes = useStyles();
  const dispatch = useDispatch();
  const [sheet, setSheet] = useState<StyleSheet<string> | null>();
  const [selectedFolder, setSelectedFolder] = useSelectedFolder();
  const [selectedIndex, setSelectedIndex] = useSelectedIndex();
  const selectedFile = useSelector(selectSelectedFile);
  const sort = useSelector(selectGallerySort);
  const preview = useSelector(selectPreview);
  const playing = useSelector(selectPlaying);
  const location = useLocation();

  const gridRef = useRef<ExtendedGrid | null>(null);
  const scroll = useRef<number>(0);
  const cancelAnimation = useRef<Function | null>(null);

  const columnCount = Math.floor(width / THUMBNAIL_HEIGHT);
  const rowCount = Math.ceil(size(selectedFolder?.children) / columnCount);

  const updated = useAutomaticChildrenLoader(selectedFolder);

  const sortedFiles = useMemo(() => {
    const [sortProperty, direction] = sort.split(':');
    const entries = values(selectedFolder?.children);

    if (sortProperty === 'fullPath') {
      const sorter = natsort({
        insensitive: true,
        desc: direction === 'desc',
      });
      return entries.sort((a, b) => sorter(a[sortProperty], b[sortProperty]));
    }

    return orderBy(entries, ...sort.split(':'));
  }, [selectedFolder, sort, updated]);

  useLayoutEffect(() => {
    const [, scrollValue] = location.hash.replace('#', '').split('_').map(Number);

    gridRef.current?.scrollToPosition({ scrollLeft: 0, scrollTop: scrollValue || 0 });
  }, [selectedFolder]);

  useEffect(() => {
    const [index, scrollValue] = location.hash.replace('#', '').split('_').map(Number);

    setSelectedIndex(index || null, scrollValue || 0);
  }, [selectedFolder]);

  useEffect(() => {
    dispatch(setFilesCount(sortedFiles.length));
  }, [sortedFiles]);

  useEffect(() => {
    const x = jss.createStyleSheet({}, { link: true, generateId: (rule) => rule.key }).attach();
    setSheet(x);

    return () => {
      jss.removeStyleSheet(x);
    };
  }, []);

  useEffect(() => {
    const rule = sheet?.addRule(`grid-thumbnail-${selectedIndex}`, {
      background: 'rgba(255,255,255,.2)',
    });

    return () => {
      if (rule) {
        sheet?.deleteRule(rule.key);
      }
    };
  }, [selectedIndex, sheet]);

  const isTargetWithinGridButNotThumbnail = (target: EventTarget | null) => {
    const grid = document.getElementsByClassName(classes.grid)[0];
    const thumbnails = document.getElementsByClassName('grid-thumbnail');

    return (
      target && grid.contains(target as Node) && !some(thumbnails, (thumbnail) => thumbnail.contains(target as Node))
    );
  };

  useEventListener('click', (event: MouseEvent) => {
    if (selectedIndex !== null && isTargetWithinGridButNotThumbnail(event.target)) {
      selectIndex(null);
    }
  });

  const space = (event: React.KeyboardEvent) => {
    if (selectedIndex === null) {
      return;
    }

    if (preview && selectedFile?.isVideo() && !event.shiftKey) {
      return;
    }

    if (preview && selectedFile?.isFolder) {
      return;
    }

    event.preventDefault();
    dispatch(setPreview(!preview));
  };

  const enter = (event: React.KeyboardEvent) => {
    if (preview) {
      return;
    }

    event.preventDefault();
    openIndex(selectedIndex);
  };

  const escape = (event: React.KeyboardEvent) => {
    event.preventDefault();
    dispatch(setPreview(false));
  };

  const arrowLeft = (event: React.KeyboardEvent) => {
    if (preview && selectedFile?.isFolder) {
      return;
    }

    if (event.shiftKey || playing) {
      return;
    }

    event.preventDefault();
    if (selectedIndex === null) {
      trySelectIndex(sortedFiles.length - 1);
    } else {
      trySelectIndex(selectedIndex - 1);
    }
  };

  const arrowRight = (event: React.KeyboardEvent) => {
    if (preview && selectedFile?.isFolder) {
      return;
    }

    if (event.shiftKey || playing) {
      return;
    }

    event.preventDefault();
    if (selectedIndex === null) {
      trySelectIndex(0);
    } else {
      trySelectIndex(selectedIndex + 1);
    }
  };

  const arrowUp = (event: React.KeyboardEvent) => {
    if (preview && selectedFile?.isFolder) {
      return;
    }

    event.preventDefault();
    if (selectedIndex === null) {
      trySelectIndex(sortedFiles.length - 1);
    } else {
      trySelectIndex(selectedIndex - columnCount);
    }
  };

  const arrowDown = (event: React.KeyboardEvent) => {
    if (preview && selectedFile?.isFolder) {
      return;
    }

    event.preventDefault();
    if (selectedIndex === null) {
      trySelectIndex(0);
    } else {
      trySelectIndex(selectedIndex + columnCount);
    }
  };

  const trySelectIndex = (nextIndex: number) => {
    if (nextIndex >= 0 && nextIndex < sortedFiles.length) {
      selectIndex(nextIndex);
    }
  };

  useEventListener('mousedown', (event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });

  useEventListener('keydown', (event: React.KeyboardEvent) => {
    switch (event.key) {
      case ' ':
        return space(event);
      case 'Escape':
        return escape(event);
      case 'Enter':
        return enter(event);
      case 'ArrowLeft':
        return arrowLeft(event);
      case 'ArrowRight':
        return arrowRight(event);
      case 'ArrowUp':
        return arrowUp(event);
      case 'ArrowDown':
        return arrowDown(event);
      default:
        return false;
    }
  });

  const setSelectedFileDebounced = useDebouncedCallback(
    (file) => {
      if (file && file.isFolder) {
        dispatch(setSelectedFile(file));
      } else {
        dispatch(setSelectedFile(file));
      }
    },
    100,
    { leading: true },
  );

  const selectIndex = (index: number | null) => {
    setSelectedIndex(index, scroll.current);
    if (index !== null) {
      const file = sortedFiles[index];
      setSelectedFileDebounced(file);
      maybeScrollAnimate(index);
    }
  };

  const openIndex = (index: number | null) => {
    setSelectedIndex(index, scroll.current);
    if (index !== null) {
      const file = sortedFiles[index];
      if (file && file.isFolder) {
        setSelectedFolder(file);
        dispatch(openFolder(file.parent));
      } else {
        dispatch(setSelectedFile(file));
        dispatch(setPreview(true));
      }
    }
  };

  const maybeScrollAnimate = (nextSelectedIndex: number) => {
    if (!sortedFiles) {
      return;
    }

    const selectedRowIndex = Math.floor(nextSelectedIndex / columnCount);
    const position = selectedRowIndex * THUMBNAIL_SIZE;
    const topEdge = Math.max(0, position - THUMBNAIL_SIZE);
    const bottomEdge = Math.min(rowCount * THUMBNAIL_SIZE, position + 2 * THUMBNAIL_SIZE);

    const topDiff = Math.abs(topEdge - scroll.current);
    const bottomDiff = Math.abs(bottomEdge - (scroll.current + height));

    if (scroll.current < topEdge && bottomEdge < scroll.current + height) {
      return;
    }

    startAnimation(topDiff < bottomDiff ? topEdge : bottomEdge - height);
  };

  const startAnimation = (toValue: number) => {
    if (cancelAnimation.current) {
      cancelAnimation.current();
    }

    cancelAnimation.current = animate({
      easing: 'linear',
      fromValue: scroll.current,
      toValue,
      onUpdate: (value, callback) => {
        if (gridRef.current) {
          // eslint-disable-next-line no-underscore-dangle
          gridRef.current._scrollingContainer.scrollTop = value;
          scroll.current = value;
        }
        callback();
      },
      onComplete: () => {
        gridRef.current?.scrollToPosition({ scrollLeft: 0, scrollTop: toValue });
      },
      duration: 150,
    });
  };

  const handleScroll = ({ scrollTop }: { scrollTop: number }) => {
    scroll.current = scrollTop;
  };

  const cellRenderer = ({ columnIndex, rowIndex, style }: GridCellProps) => {
    const index = rowIndex * columnCount + columnIndex;
    const file = sortedFiles[index];
    if (!file) {
      return null;
    }

    return (
      <GridThumbnail
        key={file.fullPath}
        index={index}
        fileEntry={file}
        onClick={() => selectIndex(index)}
        onDoubleClick={() => openIndex(index)}
        onAuxClick={(event: React.MouseEvent) => {
          if (event.button === 1) {
            selectIndex(index);
            dispatch(setPreview(!preview));
          }
        }}
        style={style}
      />
    );
  };

  return (
    <Grid
      ref={gridRef}
      className={classes.grid}
      cellRenderer={cellRenderer}
      columnWidth={THUMBNAIL_HEIGHT}
      columnCount={columnCount}
      rowHeight={THUMBNAIL_SIZE}
      rowCount={rowCount}
      height={height}
      width={width}
      overscanRowCount={5}
      onScroll={handleScroll}
    />
  );
}
