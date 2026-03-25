#!/usr/bin/env node

/**
 * Pre-download V4 models for Cortex
 * 
 * Run: node scripts/download-models.mjs
 * 
 * Downloads:
 *   1. Xenova/bge-m3 (embedding, 1024d, ~2.3GB)
 *   2. Xenova/bge-reranker-base (cross-encoder, ~1.1GB)
 */

import { pipeline, env } from '@huggingface/transformers'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, rmSync, mkdirSync } from 'fs'

const CACHE_DIR = join(homedir(), 'Library', 'Application Support', 'Cortex', 'models')

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true })
}

env.cacheDir = CACHE_DIR
env.allowLocalModels = true
env.allowRemoteModels = true

// Clean broken BAAI cache if exists
const brokenCache = join(CACHE_DIR, 'BAAI')
if (existsSync(brokenCache)) {
  console.log('[cleanup] Removing broken BAAI/bge-m3 cache...')
  rmSync(brokenCache, { recursive: true, force: true })
  console.log('[cleanup] Done')
}

async function downloadEmbeddingModel() {
  console.log('\n[1/2] Downloading Xenova/bge-m3 (embedding model, 1024d)...')
  console.log('      This is ~2.3GB, may take a few minutes.\n')
  
  const start = Date.now()
  const pipe = await pipeline('feature-extraction', 'Xenova/bge-m3', {
    dtype: 'fp32'
  })
  
  // Quick test
  const testOutput = await pipe(['Hello world'], { pooling: 'cls', normalize: true })
  const dims = testOutput.tolist()[0].length
  
  console.log(`[1/2] ✅ bge-m3 loaded in ${((Date.now() - start) / 1000).toFixed(1)}s`)
  console.log(`      Dimensions: ${dims}`)
  console.log(`      Cache: ${CACHE_DIR}/Xenova/bge-m3/`)
}

async function downloadRerankerModel() {
  console.log('\n[2/2] Downloading Xenova/bge-reranker-base (cross-encoder)...')
  console.log('      This is ~1.1GB, may take a few minutes.\n')
  
  const start = Date.now()
  const pipe = await pipeline('text-classification', 'Xenova/bge-reranker-base', {
    dtype: 'fp32'
  })
  
  console.log(`[2/2] ✅ bge-reranker-base loaded in ${((Date.now() - start) / 1000).toFixed(1)}s`)
  console.log(`      Cache: ${CACHE_DIR}/Xenova/bge-reranker-base/`)
}

async function main() {
  console.log('=== Cortex V4 Model Downloader ===')
  console.log(`Cache directory: ${CACHE_DIR}\n`)
  
  try {
    await downloadEmbeddingModel()
  } catch (err) {
    console.error('[1/2] ❌ Embedding model download failed:', err.message)
  }
  
  try {
    await downloadRerankerModel()
  } catch (err) {
    console.error('[2/2] ❌ Reranker model download failed:', err.message)
  }
  
  console.log('\n=== Done! Restart Cortex to use V4 models ===')
}

main().catch(console.error)
