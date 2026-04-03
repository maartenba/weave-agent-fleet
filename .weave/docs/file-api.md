# File API Reference

> **Last updated**: 2026-04-03

API endpoints for browsing, reading, writing, renaming, and deleting workspace files within a session.

All file endpoints require an `instanceId` query parameter that identifies the running OpenCode instance. Path parameters are relative to the session's workspace root.

## Security

All file operations enforce:

- **Path traversal prevention** — `../` sequences, absolute paths, and null-byte injection are rejected with `403`.
- **`.git` protection** — reads, writes, deletes, and renames targeting `.git` directories (at any depth, case-insensitive) are rejected with `403`.
- **Symlink escape detection** — resolved symlinks are validated against the workspace root.
- **Backslash normalization** — backslash path separators are normalized before `.git` checks to prevent bypass on Windows.

## Endpoints

### List Files

```
GET /api/sessions/:id/files?instanceId=<instanceId>
```

Returns a flat list of all files and directories in the workspace, excluding `node_modules`, `.git`, and other ignored directories.

**Response** `200`:
```json
{
  "root": "/absolute/path/to/workspace",
  "files": [
    { "path": "src", "type": "directory" },
    { "path": "src/index.ts", "type": "file" },
    { "path": "README.md", "type": "file" }
  ]
}
```

**Errors**: `400` (missing instanceId), `404` (instance not found)

---

### Read File

```
GET /api/sessions/:id/files/<path>?instanceId=<instanceId>
```

Reads a single file. Text files return content as a UTF-8 string. Binary image files return base64-encoded content with MIME type. Other binary files return `content: null`.

**Response** `200` (text file):
```json
{
  "path": "src/index.ts",
  "content": "export const x = 1;",
  "size": 19,
  "language": "typescript",
  "isBinary": false,
  "isImage": false,
  "isSvg": false
}
```

**Response** `200` (image file):
```json
{
  "path": "logo.png",
  "content": "<base64-encoded>",
  "size": 4096,
  "language": null,
  "isBinary": true,
  "isImage": true,
  "isSvg": false,
  "mime": "image/png"
}
```

**Response** `200` (SVG):
```json
{
  "path": "icon.svg",
  "content": "<svg>...</svg>",
  "size": 256,
  "language": "xml",
  "isBinary": false,
  "isImage": true,
  "isSvg": true
}
```

**Response** `200` (other binary):
```json
{
  "path": "data.bin",
  "content": null,
  "size": 8192,
  "language": null,
  "isBinary": true,
  "isImage": false,
  "isSvg": false
}
```

**Errors**: `400` (missing instanceId), `403` (path traversal / .git), `404` (instance or file not found), `413` (file > 5 MB)

---

### Write File

```
POST /api/sessions/:id/files/<path>?instanceId=<instanceId>
Content-Type: application/json
```

**Request body**:
```json
{
  "content": "file content as string"
}
```

Creates or overwrites a file. Parent directories are created automatically.

**Response** `200`:
```json
{
  "success": true,
  "path": "src/new-file.ts"
}
```

**Errors**: `400` (missing instanceId, invalid JSON, content not a string), `403` (path traversal / .git), `404` (instance not found), `413` (content > 5 MB)

---

### Create Directory

```
POST /api/sessions/:id/files/<path>?instanceId=<instanceId>
Content-Type: application/json
```

**Request body**:
```json
{
  "type": "directory"
}
```

Creates a directory (and any missing parent directories).

**Response** `200`:
```json
{
  "success": true,
  "path": "src/components",
  "type": "directory"
}
```

**Errors**: `400` (missing instanceId), `403` (path traversal / .git), `404` (instance not found)

---

### Delete File or Directory

```
DELETE /api/sessions/:id/files/<path>?instanceId=<instanceId>
```

Deletes a file or directory (recursive for directories).

**Response** `200`:
```json
{
  "success": true,
  "path": "old-file.ts"
}
```

**Errors**: `400` (missing instanceId), `403` (path traversal / .git), `404` (instance or file not found)

---

### Rename / Move

```
PATCH /api/sessions/:id/files/<path>?instanceId=<instanceId>
Content-Type: application/json
```

**Request body**:
```json
{
  "newPath": "new/relative/path.ts"
}
```

Renames or moves a file or directory. Parent directories for the destination are created automatically. Both source and destination paths are validated for traversal and `.git` access. Destination must not already exist.

**Response** `200`:
```json
{
  "success": true,
  "oldPath": "old-name.ts",
  "newPath": "new-name.ts"
}
```

**Errors**: `400` (missing instanceId, invalid JSON, missing newPath), `403` (path traversal / .git on source or destination), `404` (instance or source not found), `409` (destination already exists)

---

## Git Status Coloring & Inline Diff Decorations

The Files tab uses data from the **Diffs API** (`GET /api/sessions/:id/diffs?instanceId=<instanceId>`) to power two visual features:

### File Tree Git Status Coloring

File and folder names in the tree are colored based on their git status:
- **Green** (`text-green-500`) — added files/folders
- **Amber** (`text-amber-500`) — modified files/folders
- **Red** (`text-red-500`) — deleted files/folders

Directory status is aggregated from descendants: all children added → green; any child deleted → red; mixed → amber.

Implemented via `buildGitStatusMap()` in `src/lib/git-status-utils.ts`, which takes `FileDiffItem[]` and returns a `GitStatusMap` (`Map<string, "added" | "modified" | "deleted">`).

### Monaco Editor Inline Diff Decorations

When a file has a corresponding diff entry, the Monaco editor shows gutter decorations (colored bars in the glyph margin) and subtle line backgrounds for changed lines:
- **Green bar** — added lines
- **Amber bar** — modified lines
- **Red bar** — deleted line markers

Line changes are computed by comparing the diff's `before` content against the current editor content using `computeLineChanges()` from `src/lib/line-diff.ts` (LCS-based algorithm, no external dependencies). Content changes are debounced (300ms) to avoid lag during typing.
