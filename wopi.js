const Dom = require('xmldom').DOMParser;
const http = require('http');
const https = require('https');
const xpath = require('xpath');
const fs = require('fs');
const {Readable} = require('stream');
const {encrypt, decrypt} = require('./crypto');

async function discovery({OFFICE_BASE_URL, req, res}) {
  const filePathHash = encrypt(req.query.id);
  let httpClient = OFFICE_BASE_URL.startsWith('https') ? https : http;
  let data = '';
  let request = httpClient.get(
    OFFICE_BASE_URL + '/hosting/discovery',
    (response) => {
      response.on('data', (chunk) => {
        data += chunk.toString();
      });
      response.on('end', () => {
        let err;
        if (response.statusCode !== 200) {
          err = 'Request failed. Satus Code: ' + response.statusCode;
          response.resume();
          res.status(response.statusCode).send(err);
          console.log(err);
          return;
        }
        if (!response.complete) {
          err =
            'No able to retrieve the discovery.xml file from the Collabora Online server with the submitted address.';
          res.status(404).send(err);
          console.log(err);
          return;
        }
        let doc = new Dom().parseFromString(data);
        if (!doc) {
          err = 'The retrieved discovery.xml file is not a valid XML file';
          res.status(404).send(err);
          console.log(err);
          return;
        }
        let mimeType = 'text/plain';
        let nodes = xpath.select(
          '/wopi-discovery/net-zone/app[@name=\'' + mimeType + '\']/action',
          doc
        );
        if (!nodes || nodes.length !== 1) {
          err = 'The requested mime type is not handled';
          res.status(404).send(err);
          console.log(err);
          return;
        }
        let onlineUrl = nodes[0].getAttribute('urlsrc');
        res.json({
          url: onlineUrl,
          token: 'test',
          fileId: filePathHash,
        });
      });
      response.on('error', (err) => {
        res.status(404).send('Request error: ' + err);
        console.log('Request error: ' + err.message);
      });
    }
  );
  request.on('error', (err) => {
    res.status(404).send('Request error: ' + err);
    console.error(err);
  });
}

/* *
 *  wopi CheckFileInfo endpoint
 *
 *  Returns info about the file with the given document id.
 *  The response has to be in JSON format and at a minimum it needs to include
 *  the file name and the file size.
 *  The CheckFileInfo wopi endpoint is triggered by a GET request at
 *  https://HOSTNAME/wopi/files/<document_id>
 */
async function checkFileInfo({req, res, vfs, userInfo}) {
  const filePath = decrypt(req.params.fileId);
  const fileName = filePath.split('/').pop();
  let fileSize = null;

  try {
    try {
      await vfs
        .call({method: 'stat', user: {username: userInfo.username}}, filePath)
        .then((response) => {
          if ('size' in response) {
            fileSize = response.size;
          } else {
            throw new Error();
          }
        });
    } catch{
      await vfs
        .call(
          {method: 'readfile', user: {username: userInfo.username}},
          filePath
        )
        .then((response) => {
          fileSize = response.headers['content-length'];
        });
    }

    res.json({
      BaseFileName: fileName,
      Size: fileSize,
      UserId: userInfo.id,
      OwnerId: userInfo.username,
      UserCanWrite: true,
      // UserCanNotWriteRelative: false,  // to show Save As button
      SupportsUpdate: true,
      PostMessageOrigin: 'http://192.168.1.144:8000',
    });
  } catch (err) {
    console.log(err);
  }
}

/* *
 *  wopi GetFile endpoint
 *
 *  Given a request access token and a document id, sends back the contents of the file.
 *  The GetFile wopi endpoint is triggered by a request with a GET verb at
 *  https://HOSTNAME/wopi/files/<document_id>/contents
 */
async function getFile({req, res, vfs, userInfo}) {
  const filePath = decrypt(req.params.fileId);

  if (filePath.startsWith('myMonster')) {
    await vfs
      .call({method: 'readfile', user: {username: userInfo.username}}, filePath)
      .then((response) => {
        response.pipe(res);
      });
  } else {
    const realPath = await vfs.realpath(filePath, {
      username: userInfo.username,
    });
    const fileBuffer = fs.readFileSync(realPath);
    res.send(fileBuffer);
  }
}

/* *
 * wopi PutFile endpoint
 *
 * Given a request access token and a document id, replaces the files with the POST request body.
 * The PutFile wopi endpoint is triggered by a request with a POST verb at
 * https://HOSTNAME/wopi/files/<document_id>/contents
 */
async function putFile({req, res, vfs, userInfo}) {
  if (req.body) {
    const filePath = decrypt(req.params.fileId);
    const stream = Readable.from(req.body);
    await vfs.call(
      {method: 'writefile', user: {username: userInfo.username}},
      filePath,
      stream
    );
    res.sendStatus(200);
  } else {
    console.log('Not possible to get the file content.');
    res.sendStatus(404);
  }
}

module.exports = {
  discovery,
  checkFileInfo,
  getFile,
  putFile,
};
