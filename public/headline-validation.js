function validateHeadline(title) {
  if (typeof title !== "string" || !title.trim()) {
    return "Enter a headline.";
  }
  if (/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[#*0-9]\uFE0F?\u20E3/u.test(title)) {
    return "Headlines cannot contain emoji.";
  }
  if (/([\p{P}\p{S}])\1{3,}/u.test(title)) {
    return "Do not repeat the same symbol or punctuation more than three times in a row.";
  }
  return "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = validateHeadline;
} else {
  window.validateHeadline = validateHeadline;
}
