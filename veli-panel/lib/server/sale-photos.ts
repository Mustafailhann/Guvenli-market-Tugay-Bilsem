import { createPhotoHandlers } from './photo-handler.ts';
import { createPhotoReader, photoProjectId, verifyPhotoToken } from './photo-firebase.ts';
import { privatePhotoStore } from './photo-storage.ts';

export const handleSalePhoto = createPhotoHandlers({
    projectId: photoProjectId,
    enabled: () => process.env.PHOTO_STORAGE_BACKEND === 'vercel-blob',
    verify: verifyPhotoToken,
    reader: createPhotoReader,
    store: privatePhotoStore,
    legacyOrigin: () => process.env.PHOTO_SERVER_URL,
});
