function createVideoPreviewController({
  activate,
  deactivate,
  threshold = 0.6,
  unloadThreshold = 0.1
}) {
  const visibility = new Map();
  const loadedVideos = new Set();
  let selectedVideo = null;
  let isPlaying = false;
  let isBlocked = false;
  let autoplayEnabled = true;

  function sync() {
    let nextVideo = null;
    let highestRatio = -1;
    visibility.forEach((ratio, video) => {
      if (ratio >= threshold && ratio > highestRatio) {
        nextVideo = video;
        highestRatio = ratio;
      }
    });

    if (nextVideo !== selectedVideo) {
      if (selectedVideo && loadedVideos.has(selectedVideo)) {
        if (visibility.get(selectedVideo) <= unloadThreshold) {
          deactivate(selectedVideo, true);
          loadedVideos.delete(selectedVideo);
        } else {
          deactivate(selectedVideo, false);
        }
      }
      selectedVideo = nextVideo;
      isPlaying = false;
    }

    const shouldPlay = Boolean(selectedVideo && autoplayEnabled && !isBlocked);
    if (shouldPlay !== isPlaying) {
      isPlaying = shouldPlay;
      if (shouldPlay) {
        loadedVideos.add(selectedVideo);
        activate(selectedVideo);
      } else if (selectedVideo && loadedVideos.has(selectedVideo)) {
        deactivate(selectedVideo, false);
      }
    }

    loadedVideos.forEach((video) => {
      if (video !== selectedVideo && visibility.get(video) <= unloadThreshold) {
        deactivate(video, true);
        loadedVideos.delete(video);
      }
    });
  }

  return {
    register(video) {
      visibility.set(video, 0);
    },
    update(entries) {
      entries.forEach((entry) => {
        if (!visibility.has(entry.target)) return;
        const ratio = entry.isIntersecting && Number.isFinite(entry.intersectionRatio)
          ? Math.min(1, Math.max(0, entry.intersectionRatio))
          : 0;
        visibility.set(entry.target, ratio);
      });
      sync();
    },
    setBlocked(blocked) {
      isBlocked = blocked;
      sync();
    },
    setAutoplayEnabled(enabled) {
      autoplayEnabled = enabled;
      sync();
    },
    clear() {
      loadedVideos.forEach((video) => deactivate(video, true));
      loadedVideos.clear();
      visibility.clear();
      selectedVideo = null;
      isPlaying = false;
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = createVideoPreviewController;
} else {
  window.createVideoPreviewController = createVideoPreviewController;
}
