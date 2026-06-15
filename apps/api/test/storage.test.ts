import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/errors";
import { StorageService, UploadedFile, sanitizeFilename } from "../src/storage";

class StubFile implements UploadedFile {
  readonly name: string;
  readonly data: Buffer;
  readonly type: string;

  constructor(filename: string, data: Buffer | string, contentType = "application/octet-stream") {
    this.name = filename;
    this.data = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.type = contentType;
  }
}

type Store = Record<string, { data: Buffer; contentType?: string }>;

class FakeFile {
  constructor(
    private readonly bucketName: string,
    private readonly objectName: string,
    private readonly store: Store,
  ) {}

  async save(data: Buffer, options: { contentType?: string } = {}): Promise<void> {
    this.store[`${this.bucketName}/${this.objectName}`] = {
      data: Buffer.from(data),
      contentType: options.contentType,
    };
  }

  async getSignedUrl(): Promise<[string]> {
    return [`https://signed.example/${this.bucketName}/${this.objectName}`];
  }
}

class FakeBucket {
  constructor(
    private readonly bucketName: string,
    private readonly store: Store,
  ) {}

  file(objectName: string): FakeFile {
    return new FakeFile(this.bucketName, objectName, this.store);
  }
}

class FakeStorageClient {
  readonly store: Store = {};

  bucket(bucketName: string): FakeBucket {
    return new FakeBucket(bucketName, this.store);
  }
}

test("uploadBundle stores source and documents", async () => {
  const client = new FakeStorageClient();
  const service = new StorageService("uploads", {
    uploadsPrefixTemplate: "uploads/{upload_id}",
    storageClient: client,
  });

  const bundle = await service.uploadBundle(
    "upload-123",
    new StubFile("source.zip", zipBytes({ "app.py": "print('hello')" })),
    [new StubFile("spec.md", "# Spec\n", "text/markdown"), new StubFile("../design.pdf", "%PDF")],
  );

  assert.equal(bundle.source.uri, "gs://uploads/uploads/upload-123/source/source.zip");
  assert.equal(bundle.documents[0].uri, "gs://uploads/uploads/upload-123/documents/0001-spec.md");
  assert.equal(bundle.documents[1].uri, "gs://uploads/uploads/upload-123/documents/0002-design.pdf");
  assert.ok(client.store["uploads/uploads/upload-123/source/source.zip"]);
});

test("uploadBundle rejects source that is not a readable zip", async () => {
  const service = new StorageService("uploads", { storageClient: new FakeStorageClient() });

  await assert.rejects(
    () => service.uploadBundle("upload-123", new StubFile("source.zip", "not zip"), [new StubFile("spec.md", "# Spec\n")]),
    ApiError,
  );
});

test("sanitizeFilename removes paths and unsafe characters", () => {
  assert.equal(sanitizeFilename("../my source (copy).zip"), "my_source_copy.zip");
  assert.equal(sanitizeFilename("ソースコード.zip"), "file.zip");
  assert.equal(sanitizeFilename("..."), "file");
});

test("signedUrl uses GCS URI target", async () => {
  const service = new StorageService("uploads", { storageClient: new FakeStorageClient() });

  const url = await service.signedUrl("gs://results/results/job-1/true-design.md", 300);

  assert.equal(url, "https://signed.example/results/results/job-1/true-design.md");
});

function zipBytes(files: Record<string, Buffer | string>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
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
