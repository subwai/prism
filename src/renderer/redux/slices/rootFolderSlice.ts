import { createSlice } from '@reduxjs/toolkit';
import { get } from 'lodash';
// eslint-disable-next-line import/no-cycle
import { FileEntryModel, findFolderAndIndex } from '../../models/FileEntry';
// eslint-disable-next-line import/no-cycle
import { RootState } from '../store';

type State = {
  folder: FileEntryModel | null;
  path: string | null;
  cachePath: string | null;
};

const rootFolderSlice = createSlice({
  name: 'rootFolder',
  initialState: <State>{ folder: null, path: null, cachePath: null },
  reducers: {
    setRootFolder: (state, action) => {
      state.folder = action.payload ? new FileEntryModel(action.payload) : null;
    },
    setRootFolderPath: (state, action) => {
      state.path = action.payload;
    },
    setCachePath: (state, action) => {
      state.cachePath = action.payload;
    },
    updateFile: (state, action) => {
      const { folder, index } = findFolderAndIndex(state.folder, action.payload.fullPath) as {
        folder: FileEntryModel;
        index: number;
      };
      if (folder && folder.children !== null) {
        if (index !== null) {
          folder.children[index].children = folder.children[index].convertToFileEntryModels(action.payload.children);
          folder.children[index].triggerEventSoon('update');
        } else {
          const newFile = new FileEntryModel(Object.assign(action.payload, { parent: folder }));
          folder.children.push(newFile);
          newFile.triggerEventSoon('add');
        }
      }
    },
    removeFile: (state, action) => {
      const { folder, index } = findFolderAndIndex(state.folder, action.payload) as {
        folder: FileEntryModel;
        index: number;
      };
      if (folder && folder.children !== null && index !== null) {
        const [deletedFolder] = folder.children.splice(index, 1);
        deletedFolder.triggerEventSoon('remove');
      }
    },
  },
});

export const { setRootFolder, setRootFolderPath, setCachePath, updateFile, removeFile } = rootFolderSlice.actions;

export default rootFolderSlice.reducer;

export const selectRootFolder = (state: RootState) => state.rootFolder.folder;
export const selectRootFolderPath = (state: RootState) => state.rootFolder.path;
export const selectCachePath = (state: RootState) => state.rootFolder.cachePath;
export const selectFolder = (path: string | undefined) => (state: RootState) =>
  path === undefined ? state.rootFolder.folder : get(state.rootFolder.folder, path);
