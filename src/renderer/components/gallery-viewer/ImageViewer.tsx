import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import { createUseStyles } from 'react-jss';
import { useDispatch, useSelector } from 'react-redux';
import { ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

// eslint-disable-next-line import/no-cycle
import PeekGridViewer from 'renderer/components/gallery-viewer/peek-grid-viewer/PeekGridViewer';
import useEventListener from 'renderer/hooks/useEventListener';
import { FileEntryModel, isVideo } from 'renderer/models/FileEntry';
import { selectRootFolder } from 'renderer/redux/slices/rootFolderSlice';
import { selectSelectedFile } from 'renderer/redux/slices/selectedFolderSlice';
import { pause, play, selectPlaying, selectPreview, setPreview } from 'renderer/redux/slices/viewerSlice';

const useStyles = createUseStyles({
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  selectText: {
    margin: '0 auto',
    alignSelf: 'center',
  },
  gridWrapper: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
    background: 'rgba(20,20,20,.9)',
  },
  innerGridWrapper: {
    width: '80%',
    height: '80%',
    background: 'black',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    cursor: 'pointer',
    display: 'flex',
  },
  transformWrapper: {
    width: '100%',
    height: '100%',
  },
  transformComponent: {
    width: '100%',
    height: '100%',
  },
  preview: {
    position: 'absolute',
    width: '100%',
    height: 'calc(100% + 35px)',
    top: -35,
    left: 0,
    zIndex: 2,
    background: 'rgba(20,20,20,.9)',
  },
});

export default function ImageViewer() {
  const selectedFile = useSelector(selectSelectedFile);

  return <FileImageViewer fileEntry={selectedFile} />;
}

type FileImageViewerProps = {
  fileEntry: FileEntryModel | null;
  setPeek?: (value: boolean) => void;
};

export function FileImageViewer({ fileEntry, setPeek }: FileImageViewerProps) {
  const classes = useStyles();
  const dispatch = useDispatch();
  const rootFolder = useSelector(selectRootFolder);
  const globalSelectedFile = useSelector(selectSelectedFile);
  const playing = useSelector(selectPlaying);
  const preview = useSelector(selectPreview);
  const videoElement = useRef<HTMLVideoElement>(null);
  const imageElement = useRef<HTMLImageElement>(null);
  const imageWrapper = useRef<HTMLDivElement>(null);
  const transformer = useRef<ReactZoomPanPinchRef>(null);

  const context = transformer.current?.instance.getContext();

  useEffect(() => {
    if (playing) {
      dispatch(pause());
    }
  }, [fileEntry, dispatch]);

  useEffect(() => {
    transformer.current?.setTransform(context?.state.positionX || 0, 0, context?.state.scale || 1, 0);
  }, [fileEntry]);

  const space = (event: React.KeyboardEvent) => {
    if (videoElement.current) {
      event.preventDefault();
      if (event.shiftKey) {
        dispatch(setPreview(!preview));
      } else if (videoElement.current.paused) {
        videoElement.current.play().catch(console.error);
      } else {
        videoElement.current.pause();
      }
    }
    if (imageWrapper.current && !document.fullscreenElement) {
      event.preventDefault();
      dispatch(setPreview(!preview));
    }
  };

  const arrowLeft = (event: React.KeyboardEvent) => {
    if (videoElement.current && !videoElement.current.paused && !event.shiftKey) {
      event.preventDefault();
      videoElement.current.currentTime = Math.max(0, videoElement.current.currentTime - 5);
    }
  };

  const arrowRight = (event: React.KeyboardEvent) => {
    if (videoElement.current && !videoElement.current.paused && !event.shiftKey) {
      event.preventDefault();
      videoElement.current.currentTime = Math.min(videoElement.current.duration, videoElement.current.currentTime + 5);
    }
  };

  const pageDown = (event: React.KeyboardEvent) => {
    if (transformer.current && context) {
      const offsetMultiplier = event.shiftKey ? 0.5 : 1;
      transformer.current.setTransform(
        context.state.positionX,
        Math.max(
          context.state.positionY - transformer.current.instance.contentComponent!.offsetHeight * offsetMultiplier,
          transformer.current.instance.bounds!.minPositionY,
        ),
        context.state.scale,
      );
      event.preventDefault();
    }
  };

  const pageUp = (event: React.KeyboardEvent) => {
    if (transformer.current && context) {
      const offsetMultiplier = event.shiftKey ? 0.5 : 1;
      transformer.current.setTransform(
        context.state.positionX,
        Math.min(
          context.state.positionY + transformer.current.instance.contentComponent!.offsetHeight * offsetMultiplier,
          transformer.current.instance.bounds!.maxPositionY,
        ),
        context.state.scale,
      );
      event.preventDefault();
    }
  };

  const fKey = (event: React.KeyboardEvent) => {
    event.preventDefault();
    if (document.fullscreenElement) {
      document
        .exitFullscreen()
        .then(() => dispatch(setPreview(false)))
        .catch(console.error);
    }
    const currentElement = videoElement.current || imageWrapper.current;
    if (currentElement) {
      currentElement.requestFullscreen().catch(console.error);
    }
  };

  useEventListener('keydown', (event: React.KeyboardEvent) => {
    switch (event.key) {
      case ' ':
        return space(event);
      case 'ArrowLeft':
        return arrowLeft(event);
      case 'ArrowRight':
        return arrowRight(event);
      case 'PageDown':
        return pageDown(event);
      case 'PageUp':
        return pageUp(event);
      case 'f':
        return fKey(event);
      default:
        return false;
    }
  });

  function preventFocus(event: React.FocusEvent<HTMLImageElement | HTMLVideoElement>) {
    event.preventDefault();
    event.currentTarget.blur();
  }

  function selectFolder() {
    window.electron.send('open-folder');
  }

  if (!fileEntry && !rootFolder) {
    return (
      <div ref={imageWrapper} className={classes.imageWrapper}>
        <h2 className={classes.selectText} onClick={selectFolder}>
          Select a folder
        </h2>
      </div>
    );
  }

  if (fileEntry?.isFolder) {
    return (
      <div className={classNames(classes.gridWrapper)}>
        <div className={classes.innerGridWrapper}>
          <PeekGridViewer fileEntry={fileEntry} />
        </div>
      </div>
    );
  }

  if (fileEntry && isVideo(fileEntry)) {
    return (
      <video
        key={fileEntry.fullPath}
        ref={videoElement}
        className={classNames(classes.image, { [classes.preview]: preview })}
        controls
        loop
        onFocus={preventFocus}
        onPlay={() => dispatch(play())}
        onPause={() => dispatch(pause())}
        onAuxClick={() => {
          if (preview && globalSelectedFile?.isFolder) {
            if (setPeek) {
              setPeek(false);
            }

            return;
          }

          dispatch(setPreview(false));
        }}
      >
        <source src={`${window.electron.pathToFileURL(fileEntry.fullPath).toString()}#t=0.5`} />
      </video>
    );
  }

  return (
    <div
      ref={imageWrapper}
      className={classNames(classes.imageWrapper, { [classes.preview]: preview })}
      onAuxClick={() => {
        if (preview && globalSelectedFile?.isFolder) {
          if (setPeek) {
            setPeek(false);
          }

          return;
        }

        dispatch(setPreview(false));
      }}
    >
      <TransformWrapper
        ref={transformer}
        doubleClick={{
          mode: 'reset',
        }}
      >
        {() => (
          <TransformComponent wrapperClass={classes.transformWrapper} contentClass={classes.transformComponent}>
            {fileEntry && (
              <img
                ref={imageElement}
                className={classes.image}
                alt={fileEntry.fullPath}
                src={window.electron.pathToFileURL(fileEntry.fullPath).toString()}
              />
            )}
          </TransformComponent>
        )}
      </TransformWrapper>
    </div>
  );
}
