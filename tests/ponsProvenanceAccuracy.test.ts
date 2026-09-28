import assert from 'node:assert/strict';
import test from 'node:test';

import { decidePonsProvenanceEvidence } from '../src/chains/robinhood/ponsLaunchState.js';

test('shared live PONS provenance always classifies as PONS', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: true,
    indexedFound: false,
    indexedAvailable: false,
    directFound: false,
  }), 'PONS');
});

test('persistent PONS launch index classifies historical V1/V2 tokens as PONS', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: true,
    indexedAvailable: true,
    directFound: false,
  }), 'PONS');
});

test('direct V1 factory proof classifies token as PONS', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: false,
    indexedAvailable: true,
    directFound: true,
  }), 'PONS');
});

test('healthy PONS index with no matching launch may classify token as CUSTOM', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: false,
    indexedAvailable: true,
    directFound: false,
  }), 'CUSTOM');
});

test('database outage never converts unknown provenance into CUSTOM', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: false,
    indexedAvailable: false,
    directFound: false,
  }), 'UNKNOWN');
});

test('positive factory evidence wins even when launch index is unavailable', () => {
  assert.equal(decidePonsProvenanceEvidence({
    sharedVerified: false,
    indexedFound: false,
    indexedAvailable: false,
    directFound: true,
  }), 'PONS');
});
