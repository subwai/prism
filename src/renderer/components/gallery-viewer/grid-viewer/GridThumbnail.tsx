import classNames from 'classnames';
import { ComponentProps, memo } from 'react';
import { createUseStyles } from 'react-jss';

import GridFolderThumbnail, {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_PADDING,
  THUMBNAIL_WIDTH,
} from 'renderer/components/gallery-viewer/grid-viewer/GridFolderThumbnail';
import useThumbnail from 'renderer/hooks/useThumbnail';
import { FileEntryModel, isVideo } from 'renderer/models/FileEntry';

const useStyles = createUseStyles({
  thumbnail: {
    padding: THUMBNAIL_PADDING,
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 5,
    objectFit: 'contain',
    boxSizing: 'border-box',
    cursor: 'pointer',
    overflow: 'hidden',
    '&:after': {
      content: '"\\f1c5"',
      fontSize: 48,
      fontFamily: "'Font Awesome 5 Free'",
      color: '#333',
      display: 'inline-flex',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: '#222',
      justifyContent: 'center',
      alignItems: 'center',
    },
  },
  folderName: {
    position: 'absolute',
    width: THUMBNAIL_WIDTH,
    height: 12,
    lineHeight: '12px',
    fontSize: 12,
    left: (THUMBNAIL_HEIGHT - THUMBNAIL_WIDTH) / 2,
    bottom: THUMBNAIL_PADDING,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    textShadow: '0 0 2px #000, 0 0 2px #000',
    padding: '0 2px',
    boxSizing: 'border-box',
  },
});

interface Props {
  fileEntry: FileEntryModel;
  index: number;
  classPrefix?: string;
  onClick: ComponentProps<'div'>['onClick'];
  onDoubleClick: ComponentProps<'div'>['onDoubleClick'];
  onAuxClick: ComponentProps<'div'>['onAuxClick'];
  style: ComponentProps<'div'>['style'];
}

export default memo(function GridThumbnail({
  fileEntry,
  index,
  onClick,
  onDoubleClick,
  onAuxClick,
  style,
  classPrefix = '',
}: Props): JSX.Element | null {
  const classes = useStyles();
  const [fullPath, key, setRequestThumbnail] = useThumbnail(fileEntry);

  if (fileEntry.isFolder) {
    return (
      <div
        className={classNames(
          classes.thumbnail,
          `${classPrefix}grid-thumbnail`,
          `${classPrefix}grid-thumbnail-${index}`,
        )}
        style={style}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onAuxClick={onAuxClick}
      >
        <GridFolderThumbnail fileEntry={fileEntry} />
        <span className={classes.folderName}>{fileEntry.name}</span>
      </div>
    );
  }

  if (isVideo(fileEntry)) {
    return (
      <div
        className={classNames(
          classes.thumbnail,
          `${classPrefix}grid-thumbnail`,
          `${classPrefix}grid-thumbnail-${index}`,
        )}
        style={style}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onAuxClick={onAuxClick}
      >
        <img
          key={key}
          className={classNames(classes.image)}
          alt=""
          src={fullPath}
          onError={() => setRequestThumbnail('video')}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={classNames(classes.thumbnail, `${classPrefix}grid-thumbnail`, `${classPrefix}grid-thumbnail-${index}`)}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onAuxClick={onAuxClick}
    >
      <img
        key={key}
        className={classNames(classes.image)}
        alt=""
        src={fullPath}
        onError={() => setRequestThumbnail('image')}
        loading="lazy"
      />
    </div>
  );
});
