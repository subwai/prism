import { StyleSheet } from 'jss';
import { orderBy } from 'lodash';
import natsort from 'natsort';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createUseStyles, jss } from 'react-jss';
import { useDispatch, useSelector } from 'react-redux';
import { Grid } from 'react-virtualized';
import { useDebouncedCallback, useThrottledCallback } from 'use-debounce';
import { v4 as uuid4 } from 'uuid';
import useEventListener from '../../../hooks/useEventListener';
import useFileEventListener from '../../../hooks/useFileEventListener';
import useSelectedIndex from '../../../hooks/useSelectedIndex';
import { FileEntryModel, findAllFilesRecursive } from '../../../models/FileEntry';
import { selectHiddenFolders } from '../../../redux/slices/folderVisibilitySlice';
import { selectGallerySort, setFilesCount } from '../../../redux/slices/galleryViewerSlice';
import { selectSelectedFile, setSelectedFile } from '../../../redux/slices/selectedFolderSlice';
import { selectPlaying } from '../../../redux/slices/viewerSlice';
import animate from '../../../utils/animate';
import Thumbnail from './Thumbnail';

type ExtendedGrid = Grid & { _scrollingContainer: HTMLDivElement };

const PADDING_VERTICAL = 6;

const useStyles = createUseStyles({
  scrollContainer: {
    width: '100%',
    height: '100%',
    padding: `0 ${PADDING_VERTICAL}px 2px`,
    boxSizing: 'border-box',
    position: 'relative',
  },
  grid: {
    overflowX: 'overlay!important',
    overflowY: 'hidden!important',
  },
});

interface Props {
  folder: FileEntryModel | null;
  width: number;
  height: number;
}

export default memo(function LineScroller({ folder, width, height }: Props): JSX.Element | null {
  const classes = useStyles();
  const dispatch = useDispatch();
  const [flattenedFiles, setFlattenedFiles] = useState<FileEntryModel[] | null>(null);
  const hiddenFolders = useSelector(selectHiddenFolders);
  const selectedFile = useSelector(selectSelectedFile);
  const [selectedIndex, setSelectedIndex] = useSelectedIndex();
  const sort = useSelector(selectGallerySort);
  const container = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<StyleSheet<string> | null>();
  const [update, triggerUpdate] = useState<string | null>(null);
  const cellWidth = height;
  const cellHeight = height;

  const gridRef = useRef<ExtendedGrid | null>(null);
  const scroll = useRef<number>(0);
  const cancelAnimation = useRef<Function | null>(null);

  const updateFlattenedFiles = () => {
    setFlattenedFiles(folder ? (findAllFilesRecursive(folder, hiddenFolders) as FileEntryModel[]) : null);
  };
  const updateFlattenedFilesDebounced = useDebouncedCallback(updateFlattenedFiles, 250);
  const calculateAllFilesRecursiveThrottled = useThrottledCallback(updateFlattenedFiles, 2000);
  const triggerUpdateThrottled = useThrottledCallback(() => triggerUpdate(uuid4()), 2000);

  const sortedFiles = useMemo(() => {
    const [sortProperty, direction] = sort.split(':');

    if (sortProperty === 'fullPath') {
      const sorter = natsort({
        insensitive: true,
        desc: direction === 'desc',
      });
      return flattenedFiles?.sort((a, b) => sorter(a[sortProperty], b[sortProperty])) || [];
    }

    return orderBy(flattenedFiles, ...sort.split(':'));
  }, [flattenedFiles, sort]);

  useEffect(updateFlattenedFilesDebounced, [folder, hiddenFolders]);
  useEffect(calculateAllFilesRecursiveThrottled, [update]);
  useFileEventListener('all', triggerUpdateThrottled, folder);

  useEffect(() => {
    const x = jss.createStyleSheet({}, { link: true, generateId: (rule) => rule.key }).attach();
    setSheet(x);

    return () => {
      jss.removeStyleSheet(x);
      updateFlattenedFilesDebounced.flush();
    };
  }, []);

  useEffect(() => {
    dispatch(setFilesCount(sortedFiles.length));
    setSelectedFileByIndexDebounced(selectedIndex);
  }, [sortedFiles]);

  const setSelectedFileByIndexDebounced = useDebouncedCallback(
    (nextIndex: number | null) => {
      const nextFile = sortedFiles && nextIndex !== null ? sortedFiles[nextIndex] : null;
      if (nextFile !== selectedFile) {
        dispatch(setSelectedFile(nextFile));
      }
    },
    100,
    { leading: true }
  );

  useEffect(() => {
    setSelectedFileByIndexDebounced(selectedIndex);
    const rule = sheet?.addRule(`file-${selectedIndex}`, {
      background: 'rgba(255,255,255,.2)',
    });

    return () => {
      if (rule) {
        sheet?.deleteRule(rule.key);
      }
    };
  }, [selectedIndex, sheet]);

  const playing = useSelector(selectPlaying);

  const arrowLeft = (event: React.KeyboardEvent) => {
    event.preventDefault();
    const nextSelectedIndex = Math.max((selectedIndex === null ? sortedFiles.length : selectedIndex) - 1, 0);
    setSelectedIndex(nextSelectedIndex);
    maybeScrollAnimate(nextSelectedIndex);
  };

  const arrowRight = (event: React.KeyboardEvent) => {
    event.preventDefault();
    const nextSelectedIndex = Math.min(
      selectedIndex === null ? 0 : selectedIndex + 1,
      sortedFiles ? sortedFiles.length - 1 : 0
    );
    setSelectedIndex(nextSelectedIndex);
    maybeScrollAnimate(nextSelectedIndex);
  };

  useEventListener(
    'keydown',
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
          return !event.shiftKey && arrowLeft(event);
        case 'ArrowRight':
          return !event.shiftKey && arrowRight(event);
        default:
          return false;
      }
    },
    window,
    !playing
  );

  const firstChild = container.current?.firstChild as HTMLElement;

  useEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        scrollTo(firstChild?.scrollLeft + event.deltaY);
      }
    },
    container.current
  );

  const scrollTo = (x: number) => {
    const newEvent = new Event('scroll', { bubbles: true });
    firstChild?.dispatchEvent(newEvent);
    if (firstChild) {
      firstChild.scrollLeft = Math.max(0, x);
    }
  };

  const maybeScrollAnimate = (nextSelectedIndex: number) => {
    if (!sortedFiles) {
      return;
    }

    const position = nextSelectedIndex * height;
    const leftEdge = Math.max(0, position - height);
    const rightEdge = Math.min((sortedFiles.length + 1) * height, position + 2 * height);

    const leftDiff = Math.abs(leftEdge - scroll.current);
    const rightDiff = Math.abs(rightEdge - (scroll.current + width));

    if (scroll.current < leftEdge && rightEdge < scroll.current + width) {
      return;
    }

    startAnimation(leftDiff < rightDiff ? leftEdge : rightEdge - width);
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
          gridRef.current._scrollingContainer.scrollLeft = value;
          scroll.current = value;
        }
        callback();
      },
      onComplete: () => {
        gridRef.current?.scrollToPosition({ scrollLeft: toValue, scrollTop: 0 });
      },
      duration: 150,
    });
  };

  const handleScroll = ({ scrollLeft }: { scrollLeft: number }) => {
    scroll.current = scrollLeft;
  };

  const cellRenderer = ({ columnIndex, style }: { columnIndex: number; style: object }) => {
    if (!sortedFiles) {
      return null;
    }
    const file = sortedFiles[columnIndex];

    return (
      <Thumbnail
        key={file.fullPath}
        index={columnIndex}
        fileEntry={file}
        onClick={() => setSelectedIndex(columnIndex)}
        style={style}
      />
    );
  };

  return (
    <div ref={container} className={classes.scrollContainer}>
      <Grid
        ref={gridRef}
        className={classes.grid}
        cellRenderer={cellRenderer}
        columnWidth={cellWidth}
        columnCount={sortedFiles ? sortedFiles.length : 0}
        rowHeight={cellHeight - 2 * PADDING_VERTICAL}
        rowCount={1}
        height={height - 2}
        width={width - 12}
        overscanColumnCount={5}
        onScroll={handleScroll}
      />
    </div>
  );
});
