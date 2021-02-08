/* global Blob */
const fs = require('fs');

/* eslint-disable node/no-sync */
// Our brfs transform is extremely cranky, and will not apply itself unless
// fs.readFileSync is called here, at the top-level, outside any function, with
// a string literal path, and no encoding parameter.
export const WORKER_BLOB_URL =
  process.env.METAMASK_ENV === 'test'
    ? 'https://fake.url'
    : getWorkerUrl(
        fs.readFileSync(
          require.resolve('@mm-snap/workers/dist/pluginWorker.js'),
          'utf8',
        ),
      );
/* eslint-enable node/no-sync */

function getWorkerUrl(workerSrc) {
  // the worker must be an IIFE file
  return URL.createObjectURL(
    new Blob([workerSrc], { type: 'application/javascript' }),
  );
}
