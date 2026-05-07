
  const PRIVACY_READ_KEY = "schoolBotPrivacyReadAt";
  const PRIVACY_READ_NONCE_KEY = "schoolBotPrivacyReadNonce";
  const BOTTOM_OFFSET = 80;

  function getRegisterReadNonce() {
    try {
      return new URLSearchParams(window.location.search).get("readNonce") || "";
    } catch {
      return "";
    }
  }

  function getReturnPath() {
    try {
      const referrerUrl = new URL(document.referrer || "", window.location.origin);
      if (referrerUrl.origin === window.location.origin && referrerUrl.pathname !== window.location.pathname) {
        return `${referrerUrl.pathname}${referrerUrl.search}`;
      }
      return new URLSearchParams(window.location.search).get("returnTo") || "/";
    } catch {
      return "/";
    }
  }

  function updateRegisterBackLinks() {
    const readNonce = getRegisterReadNonce();
    const url = new URL(getReturnPath(), window.location.origin);
    if (readNonce) url.searchParams.set("readNonce", readNonce);
    document.querySelectorAll('a[href="/"], a[href="/register"], .legal-back').forEach(link => {
      link.href = `${url.pathname}${url.search}`;
    });
  }

  function isScrolledToBottom() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    return scrollTop + viewportHeight >= pageHeight - BOTTOM_OFFSET;
  }

  function savePrivacyReadTimestamp() {
    try {
      localStorage.setItem(PRIVACY_READ_KEY, String(Date.now()));
      const readNonce = getRegisterReadNonce();
      if (readNonce) localStorage.setItem(PRIVACY_READ_NONCE_KEY, readNonce);
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
  window.addEventListener("load", () => {
    updateRegisterBackLinks();
    markPrivacyReadIfComplete();
  });
