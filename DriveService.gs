function createCaseFolders(caseId, senderName) {
  const root = getOrCreateRootFolder_();
  const caseFolderName = caseId + '_' + sanitizeFileNamePart(senderName);
  const caseFolder = getOrCreateChildFolder_(root, caseFolderName);
  const subfolders = {};
  CONFIG.SUBFOLDERS.forEach(function(name) {
    subfolders[name] = getOrCreateChildFolder_(caseFolder, name);
  });
  return {
    rootFolderId: root.getId(),
    caseFolderId: caseFolder.getId(),
    caseFolderUrl: caseFolder.getUrl(),
    subfolders: Object.keys(subfolders).reduce(function(acc, name) {
      acc[name] = {
        id: subfolders[name].getId(),
        url: subfolders[name].getUrl()
      };
      return acc;
    }, {})
  };
}

function copyUploadedFilesToCase(fileIdsByGroup, folders) {
  const uploadedFolder = DriveApp.getFolderById(folders.subfolders['01_Uploaded_Files'].id);
  const copied = [];
  Object.keys(fileIdsByGroup).forEach(function(group) {
    fileIdsByGroup[group].forEach(function(fileId) {
      try {
        const file = DriveApp.getFileById(fileId);
        const copy = file.makeCopy(group + '__' + file.getName(), uploadedFolder);
        copied.push({
          group: group,
          originalFileId: fileId,
          fileId: copy.getId(),
          fileName: copy.getName(),
          mimeType: copy.getMimeType(),
          url: copy.getUrl()
        });
      } catch (err) {
        copied.push({
          group: group,
          originalFileId: fileId,
          fileId: fileId,
          fileName: 'UNREADABLE_FILE_' + fileId,
          mimeType: '',
          url: '',
          error: String(err)
        });
      }
    });
  });
  return copied;
}

function saveTextFile(folderId, fileName, content) {
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(fileName, content || '', MimeType.PLAIN_TEXT);
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}

function saveJsonFile(folderId, fileName, data) {
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(fileName, jsonStringify(data), MimeType.PLAIN_TEXT);
  return { id: file.getId(), url: file.getUrl(), name: file.getName() };
}

function getOrCreateRootFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.ROOT_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME);
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}
