(function exposeVideoThumbnailQuality(root) {
  function luminance(data, pixelIndex) {
    const index = pixelIndex * 4;
    return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }

  function scoreVideoThumbnailFrame(data, width, height) {
    if (!data || !Number.isInteger(width) || !Number.isInteger(height)
        || width < 3 || height < 3 || data.length < width * height * 4) return 0;

    let total = 0;
    let squaredTotal = 0;
    let edgeTotal = 0;
    let samples = 0;
    for (let y = 1; y < height - 1; y += 3) {
      for (let x = 1; x < width - 1; x += 3) {
        const index = y * width + x;
        const center = luminance(data, index);
        const laplacian = Math.abs(
          center * 4
          - luminance(data, index - 1)
          - luminance(data, index + 1)
          - luminance(data, index - width)
          - luminance(data, index + width)
        );
        total += center;
        squaredTotal += center * center;
        edgeTotal += laplacian;
        samples += 1;
      }
    }

    if (!samples) return 0;
    const mean = total / samples;
    const contrast = Math.sqrt(Math.max(0, squaredTotal / samples - mean * mean));
    const brightnessScore = Math.max(0, 1 - Math.abs(mean - 128) / 128);
    const contrastScore = Math.min(1, contrast / 64);
    const detailScore = Math.min(1, edgeTotal / samples / 48);
    const exposurePenalty = mean < 12 || mean > 243 ? 0.05 : 1;
    return (brightnessScore * 0.2 + contrastScore * 0.3 + detailScore * 0.5) * exposurePenalty;
  }

  root.scoreVideoThumbnailFrame = scoreVideoThumbnailFrame;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { scoreVideoThumbnailFrame };
  }
}(globalThis));
