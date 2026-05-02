
  const PRIVACY_READ_KEY = "schoolBotPrivacyReadAt";
  const BOTTOM_OFFSET = 80;

  function isScrolledToBottom() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    return scrollTop + viewportHeight >= pageHeight - BOTTOM_OFFSET;
  }

  function savePrivacyReadTimestamp() {
    try {
      localStorage.setItem(PRIVACY_READ_KEY, String(Date.now()));
    } catch (error) {
      console.warn("localStorage unavailable:", error);
    }
  }

  function markPrivacyReadIfComplete() {
    if (!isScrolledToBottom()) return;
    savePrivacyReadTimestamp();
    window.removeEventListener("scroll", markPrivacyReadIfComplete);
  }

  window.addEventListener("scroll", markPrivacyReadIfComplete, { passive: true });
  window.addEventListener("load", markPrivacyReadIfComplete);