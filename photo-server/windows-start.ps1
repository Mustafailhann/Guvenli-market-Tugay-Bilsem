$ErrorActionPreference = 'Stop'
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\ProgramData\KantinPhotoServer\private\photo-reader.json'
$env:FIREBASE_PROJECT_ID = 'okul-otomat-projesi'
$env:PHOTO_DATA_DIR = 'C:\ProgramData\KantinPhotoServer\photos'
$env:PHOTO_ALLOWED_POS_UIDS = 'oVa3bCKGOYPFONqBRVQjcnQufas1'
$env:FIRESTORE_PREFER_REST = 'true'

& 'C:\Program Files\nodejs\node.exe' --use-system-ca 'C:\ProgramData\KantinPhotoServer\app\index.js'
exit $LASTEXITCODE
