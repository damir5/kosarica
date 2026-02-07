# Product Matching Redesign: Problem Statement (External Review)

Date: February 7, 2026

## Purpose
This document defines the current product-matching problem for external reviewers and planners.
It is intentionally focused on context, constraints, and observed operational outcomes.
It does not propose a solution.

## Business Objective
The platform must reliably identify equivalent and near-equivalent products across a large retail catalog, so downstream clustering and cross-store analytics can operate on canonical product groupings.

## Current Scale
- Active catalog items: 169,435
- Theoretical all-pairs comparison space: 14,354,024,895 unordered pairs

## Current Pipeline (High Level)
1. Parse product records into normalized structured features (name/category/brand/unit/amount/pack/container attributes).
2. Generate candidate pairs using deterministic blocking/filter rules.
3. Send candidate pairs to LLM adjudication.
4. Persist adjudication outcomes and rebuild clusters from approved edges.

## Key Constraint
Candidate volume remains too high for practical full-catalog execution under current operational constraints.

## Important Existing Signals Not Used for Candidate Generation
The system already computes additional similarity signals, but candidate generation does not currently use them:
- N-gram similarity artifacts exist.
- Embedding vectors exist.

These signals are available in the system but are not part of the active candidate reduction/ranking stage in the current matching path.

## Current Candidate Volume
With current deterministic filtering, estimated candidate volume is:
- 8,725,656 candidate pairs

This is much smaller than all-pairs but still operationally heavy.

## Operational Characteristics (Observed)
- LLM adjudication is currently executed request-per-pair.
- Runtime and spend scale approximately linearly with candidate volume and adjudication depth.
- Multi-step adjudication increases call depth and total wall-clock duration.

## Cost Envelope (LLM API Only, Filtered Candidate Scale)
For the current filtered estimate (8,725,656 pairs), using measured present-day usage/pricing profile:
- Single-pass LLM adjudication: approximately $170.68
- Multi-step LLM adjudication: approximately $463.78

Notes:
- Figures above exclude infrastructure, orchestration, storage, monitoring, and human review labor.
- Figures are planning estimates, not billing guarantees.

## Time Envelope (Filtered Candidate Scale)
At current measured throughput profile:
- Single-pass LLM adjudication:
  - ~52.4 days at one worker
  - ~13.1 days at four workers
- Multi-step LLM adjudication:
  - ~183.4 days at one worker
  - ~45.9 days at four workers

## Planning Risk
Even after deterministic filtering, the candidate set is large enough that time-to-complete and cost remain major operational constraints for full-catalog runs.

## Request to External Reviewers
Provide a redesigned system proposal that addresses:
- Candidate generation and reduction at catalog scale
- Use of already-available similarity signals (including n-gram and embeddings)
- Expected precision/recall and review-load tradeoffs
- Runtime and cost model at current scale and growth scenarios
- Rollout and validation approach

This request is for architecture/design proposals only.
