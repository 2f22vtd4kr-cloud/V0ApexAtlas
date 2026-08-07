---
name: TypeScript project-reference outputs
description: Shared workspace libraries emit ignored declaration output that can become stale for consuming artifacts.
---

When a frontend consumes a composite TypeScript library through a workspace package, its typecheck must rebuild that library's project reference first; otherwise ignored declaration output can lag behind generated source and hide valid exports.

**Why:** The imported workspace can have current generated client source while consumers resolve stale or missing declarations from a previous build.

**How to apply:** Keep the consumer's validation command self-healing with a precheck project-reference build, and verify the check after removing the library's generated output.