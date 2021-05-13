/* eslint-disable import/no-cycle */
import { connectRouter } from 'connected-react-router';
import { History } from 'history';
import { combineReducers } from 'redux';
import folderSizeReducer from './slices/folderSizeSlice';
import folderVisibilityReducer from './slices/folderVisibilitySlice';
import galleryScrollerReducer from './slices/galleryScrollerSlice';
import playerReducer from './slices/playerSlice';
import rootFolderReducer from './slices/rootFolderSlice';
import selectedFolderReducer from './slices/selectedFolderSlice';

export default function createRootReducer(history: History) {
  return combineReducers({
    router: connectRouter(history),
    player: playerReducer,
    folderVisibility: folderVisibilityReducer,
    galleryScroller: galleryScrollerReducer,
    rootFolder: rootFolderReducer,
    selectedFolder: selectedFolderReducer,
    folderSize: folderSizeReducer,
  });
}
