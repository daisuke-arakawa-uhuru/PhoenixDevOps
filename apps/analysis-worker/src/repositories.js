"use strict";

const JobStatus = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
});

class FirestoreJobRepository {
  constructor(collectionName) {
    const { Firestore, FieldValue } = require("@google-cloud/firestore");
    this.firestoreFieldValue = FieldValue;
    this.collection = new Firestore().collection(collectionName);
  }

  async get(jobId) {
    const snapshot = await this.collection.doc(jobId).get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() || {};
    return {
      jobId,
      status: String(data.status || ""),
      artifactPaths: { ...(data.artifact_paths || data.artifactPaths || {}) },
      errorMessage: data.error_message || data.errorMessage || null,
    };
  }

  async markRunning(jobId) {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.RUNNING,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: null,
      },
      { merge: true },
    );
  }

  async markSucceeded(jobId, artifactPaths) {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.SUCCEEDED,
        artifact_paths: artifactPaths,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: null,
      },
      { merge: true },
    );
  }

  async markFailed(jobId, errorMessage) {
    await this.collection.doc(jobId).set(
      {
        status: JobStatus.FAILED,
        updated_at: this.firestoreFieldValue.serverTimestamp(),
        error_message: errorMessage,
      },
      { merge: true },
    );
  }
}

class InMemoryJobRepository {
  constructor() {
    this.records = {};
    this.transitions = {};
  }

  async get(jobId) {
    return this.records[jobId] || null;
  }

  async markRunning(jobId) {
    this.transitions[jobId] = JobStatus.RUNNING;
    this.records[jobId] = { jobId, status: JobStatus.RUNNING, artifactPaths: {}, errorMessage: null };
  }

  async markSucceeded(jobId, artifactPaths) {
    this.transitions[jobId] = JobStatus.SUCCEEDED;
    this.records[jobId] = {
      jobId,
      status: JobStatus.SUCCEEDED,
      artifactPaths: { ...artifactPaths },
      errorMessage: null,
    };
  }

  async markFailed(jobId, errorMessage) {
    this.transitions[jobId] = JobStatus.FAILED;
    this.records[jobId] = {
      jobId,
      status: JobStatus.FAILED,
      artifactPaths: {},
      errorMessage,
    };
  }
}

function utcNowIso() {
  return new Date().toISOString();
}

module.exports = {
  FirestoreJobRepository,
  InMemoryJobRepository,
  JobStatus,
  utcNowIso,
};
