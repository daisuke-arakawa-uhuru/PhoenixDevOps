"use strict";

const zlib = require("node:zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function readZipEntries(buffer) {
  const archive = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocdOffset = findEndOfCentralDirectory(archive);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const entries = [];

  let offset = centralDirectoryOffset;
  while (offset < centralDirectoryEnd) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory");
    }

    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraFieldLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const fileName = archive
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    if (!fileName.endsWith("/")) {
      entries.push({
        name: fileName,
        data: readZipEntryData(archive, localHeaderOffset, compressionMethod, compressedSize),
      });
    }

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

function readZipEntryData(archive, localHeaderOffset, compressionMethod, compressedSize) {
  if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Invalid ZIP local file header");
  }

  const fileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = archive.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (compressionMethod === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

function findEndOfCentralDirectory(archive) {
  const minOffset = Math.max(0, archive.length - 0xffff - 22);
  for (let offset = archive.length - 22; offset >= minOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("ZIP end of central directory not found");
}

module.exports = {
  readZipEntries,
};
