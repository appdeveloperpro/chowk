const extensionByMime = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav"
};
const assetTypeByMime = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio"
};
const assetTypes = new Set(["image", "video", "audio", "video_thumbnail"]);
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function validateAssetRegistration(body, ownerId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Provide valid media details for a file uploaded by your account." };
  }
  const objectPath = typeof body.path === "string" ? body.path : "";
  const mimeType = typeof body.mime_type === "string" ? body.mime_type : "";
  const assetType = body.asset_type;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const fileSize = Number(body.file_size);
  const sourceVideoAssetId = body.source_video_asset_id || null;
  const optionalTextLimits = {
    alt_text: 500,
    description: 1000,
    credit_line: 200,
    license_name: 160
  };
  const metadata = {};
  for (const [field, limit] of Object.entries(optionalTextLimits)) {
    const value = body[field] === undefined ? "" : body[field];
    if (typeof value !== "string" || value.trim().length > limit) {
      return { error: `Enter a valid ${field.replaceAll("_", " ")}.` };
    }
    metadata[field] = value.trim();
  }
  const ownerPrefix = `${ownerId}/`;
  if (!objectPath.startsWith(ownerPrefix)
      || !new RegExp(`^${uuidPattern}/${uuidPattern}\\.(?:jpg|png|webp|avif|mp4|webm|mp3|m4a|ogg|wav)$`, "i").test(objectPath)
      || !extensionByMime[mimeType]
      || !objectPath.endsWith(extensionByMime[mimeType])
      || !assetTypes.has(assetType)
      || (assetType !== "video_thumbnail" && assetTypeByMime[mimeType] !== assetType)
      || (assetType === "video_thumbnail" && !mimeType.startsWith("image/"))
      || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 25 * 1024 * 1024
      || !title || title.length > 160) {
    return { error: "Provide valid media details for a file uploaded by your account." };
  }

  const tags = body.tags === undefined ? [] : body.tags;
  if (!Array.isArray(tags) || tags.length > 20
      || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 32)) {
    return { error: "Asset tags must contain up to 20 names of 32 characters or fewer." };
  }
  if (sourceVideoAssetId !== null
      && (assetType !== "video_thumbnail"
        || typeof sourceVideoAssetId !== "string"
        || !new RegExp(`^${uuidPattern}$`, "i").test(sourceVideoAssetId))) {
    return { error: "Choose a valid source video for this thumbnail." };
  }
  const dimensionsAreValid = ["image_width", "image_height"].every((key) =>
    body[key] === undefined || body[key] === null
    || (Number.isInteger(body[key]) && body[key] >= 1 && body[key] <= 8192)
  );
  if (!dimensionsAreValid) {
    return { error: "Image dimensions must be between 1 and 8192 pixels." };
  }

  return {
    record: {
      storage_path: objectPath,
      asset_type: assetType,
      title,
      alt_text: metadata.alt_text,
      description: metadata.description,
      tags: tags.map((tag) => tag.trim()),
      credit_line: metadata.credit_line,
      license_name: metadata.license_name,
      mime_type: mimeType,
      file_size: fileSize,
      image_width: body.image_width || null,
      image_height: body.image_height || null,
      source_video_asset_id: sourceVideoAssetId,
      created_by: ownerId,
      status: "active"
    }
  };
}

function validateAssetMetadataChanges(body, archivedAt = new Date().toISOString()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Provide asset details to update." };
  }
  const changes = {};
  const textLimits = {
    title: 160,
    alt_text: 500,
    description: 1000,
    credit_line: 200,
    license_name: 160
  };
  for (const [field, limit] of Object.entries(textLimits)) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length > limit
        || (field === "title" && !body[field].trim())) {
      return { error: `Enter a valid ${field.replaceAll("_", " ")}.` };
    }
    changes[field] = body[field].trim();
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 20
        || body.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 32)) {
      return { error: "Asset tags must contain up to 20 names of 32 characters or fewer." };
    }
    changes.tags = body.tags.map((tag) => tag.trim());
  }
  if (body.status !== undefined) {
    if (!["active", "archived"].includes(body.status)) {
      return { error: "Choose active or archived status." };
    }
    changes.status = body.status;
    changes.archived_at = body.status === "archived" ? archivedAt : null;
  }
  if (!Object.keys(changes).length) return { error: "Provide asset details to update." };
  return { changes };
}

module.exports = { validateAssetRegistration, validateAssetMetadataChanges };
