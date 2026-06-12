"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AnalysisTaskPayload } = require("../src/payload");
const { GcsInputLoader, LocalFileInputLoader } = require("../src/storage");

class FakeFile {
  constructor(data) {
    this.data = data;
  }

  async download() {
    return [this.data];
  }
}

class FakeBucket {
  constructor(objects) {
    this.objects = objects;
  }

  file(objectName) {
    return new FakeFile(this.objects[objectName]);
  }
}

class FakeStorageClient {
  constructor(buckets) {
    this.buckets = buckets;
  }

  bucket(bucketName) {
    return new FakeBucket(this.buckets[bucketName]);
  }
}

test("LocalFileInputLoader loads text files from local source and documents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-worker-"));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "README.md"), "# App\n", "utf8");
  fs.mkdirSync(path.join(source, "node_modules"));
  fs.writeFileSync(path.join(source, "node_modules", "ignored.js"), "ignored", "utf8");
  const document = path.join(root, "spec.md");
  fs.writeFileSync(document, "# Spec\n", "utf8");

  const bundle = await new LocalFileInputLoader(source, [document]).load();

  assert.equal(bundle.sourceArchiveUri, source);
  assert.equal(bundle.sourceFiles[0].path, "README.md");
  assert.equal(bundle.sourceFiles[0].content, "# App\n");
  assert.equal(bundle.documentFiles[0].content, "# Spec\n");
});

test("LocalFileInputLoader extracts text from local xlsx documents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-worker-"));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "README.md"), "# App\n", "utf8");
  const document = path.join(root, "spec.xlsx");
  fs.writeFileSync(document, minimalXlsxBytes());

  const bundle = await new LocalFileInputLoader(source, [document]).load();

  assert.match(bundle.documentFiles[0].content, /Feature/);
  assert.match(bundle.documentFiles[0].content, /Login/);
});

test("GcsInputLoader loads source zip and text documents from GCS", async () => {
  const storageClient = new FakeStorageClient({
    uploads: {
      "source.zip": zipBytes({ "app.py": "print('hello')" }),
      "docs/spec.md": Buffer.from("# Spec\n", "utf8"),
    },
  });
  const payload = AnalysisTaskPayload.fromMapping({
    jobId: "job-123",
    sourceArchiveUri: "gs://uploads/source.zip",
    documentUris: ["gs://uploads/docs/spec.md"],
  });

  const bundle = await new GcsInputLoader({ storageClient }).load(payload);

  assert.equal(bundle.sourceArchiveUri, "gs://uploads/source.zip");
  assert.equal(bundle.sourceFiles[0].path, "app.py");
  assert.equal(bundle.sourceFiles[0].content, "print('hello')");
  assert.equal(bundle.documentFiles[0].path, "docs/spec.md");
  assert.equal(bundle.documentFiles[0].content, "# Spec\n");
});

function minimalXlsxBytes() {
  return zipBytes({
    "xl/sharedStrings.xml": [
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      "<si><t>Feature</t></si>",
      "<si><t>Login</t></si>",
      "</sst>",
    ].join(""),
    "xl/worksheets/sheet1.xml": [
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      "<sheetData>",
      '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>',
      "</sheetData>",
      "</worksheet>",
    ].join(""),
  });
}

function zipBytes(files) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localRecords.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralRecords.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const localData = Buffer.concat(localRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDirectory, end]);
}
