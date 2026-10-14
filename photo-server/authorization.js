'use strict';

function viewerCanAccessStudent(viewer, student, sale, approvedRequests = [], actor = {}) {
  if (!viewer || viewer.aktif === false) return false;
  if (viewer.role === 'admin' && actor.admin === true) return true;
  if (!student || !sale.ogrenciId) return false;
  if (Array.isArray(student.veliIDleri) && student.veliIDleri.includes(viewer.id)) return true;
  return approvedRequests.some((request) => request.durum === 'onaylandi' &&
    [sale.ogrenciId, student.kartID].includes(request.kartID));
}

module.exports = { viewerCanAccessStudent };
