import { createPhotoQueueStatusHandler } from '@/lib/server/photo-queue-status';
import { createPhotoReader, verifyPhotoToken } from '@/lib/server/photo-firebase';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const POST = createPhotoQueueStatusHandler({
    verify: verifyPhotoToken,
    reader: createPhotoReader,
    report: status => console.info('PHOTO_QUEUE_STATUS', JSON.stringify(status)),
});
