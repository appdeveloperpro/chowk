(() => {
  const nativeFetch = window.fetch.bind(window);
  let activeAction = null;
  const actionTimeoutMs = 5_000;

  function feedbackRegion(target, create = true) {
    const form = target.closest("form");
    const tableCell = target.closest("td");
    const rowActions = target.closest(
      ".admin-row-actions, .admin-card-actions, .reporter-actions, .workspace-story-actions"
    );
    const container = form || tableCell || rowActions || target.parentElement || target;
    let region = container.querySelector(":scope > .inline-feedback-region");
    if (!region && create) {
      region = document.createElement("div");
      region.className = "inline-feedback-region";
      region.hidden = true;
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      container.append(region);
    }
    return region;
  }

  function renderFeedback(action, kind, message) {
    const region = action.region || feedbackRegion(action.target);
    action.region = region;
    if (!region) return;
    if (!region.isConnected) return;
    region.className = `inline-feedback-region ${kind}`;
    region.setAttribute("role", kind === "error" ? "alert" : "status");
    region.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    region.textContent = message;
    region.hidden = false;
  }

  function show(kind, message, target = null) {
    const action = activeAction
      || (target instanceof HTMLElement
        ? { target, region: feedbackRegion(target) }
        : null);
    if (!action || typeof message !== "string" || !message.trim()) return false;
    renderFeedback(action, kind, message.trim());
    return Boolean(action.region?.isConnected);
  }

  function clearFieldFeedback(field) {
    const describedBy = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    const feedbackIds = describedBy.filter((id) => id.startsWith("inline-field-feedback-"));
    if (!feedbackIds.length) return;
    field.removeAttribute("aria-invalid");
    const remainingDescriptions = describedBy.filter((id) => !feedbackIds.includes(id));
    if (remainingDescriptions.length) {
      field.setAttribute("aria-describedby", remainingDescriptions.join(" "));
    } else {
      field.removeAttribute("aria-describedby");
    }
    feedbackIds.forEach((id) => document.getElementById(id)?.remove());
  }

  function clear(target) {
    if (!(target instanceof Element)) return false;
    const regions = [
      ...(target.matches(".inline-feedback-region") ? [target] : []),
      ...target.querySelectorAll(".inline-feedback-region")
    ];
    regions.forEach((region) => {
      region.hidden = true;
      region.textContent = "";
      region.removeAttribute("aria-busy");
    });
    const fields = target.matches("input, select, textarea")
      ? [target]
      : [...target.querySelectorAll("input, select, textarea")];
    const hadFieldFeedback = fields.some((field) =>
      (field.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .some((id) => id.startsWith("inline-field-feedback-"))
    );
    fields.forEach(clearFieldFeedback);
    return regions.length > 0 || hadFieldFeedback;
  }

  function beginAction(target, submitter = null) {
    const control = submitter || target;
    if (!(control instanceof HTMLElement)) return;
    if (activeAction?.timer) clearTimeout(activeAction.timer);
    const region = feedbackRegion(target, false);
    const action = {
      target,
      control,
      region,
      pending: 0,
      fetchAvailable: true,
      hasError: false,
      timer: null,
      restoreDisabled: null
    };
    activeAction = action;
    action.timer = setTimeout(() => {
      if (activeAction === action && action.pending === 0) activeAction = null;
    }, actionTimeoutMs);
    return action;
  }

  function keepActionAvailable(action) {
    if (action.timer) clearTimeout(action.timer);
    action.timer = setTimeout(() => {
      if (action.pending === 0 && activeAction === action) activeAction = null;
    }, actionTimeoutMs);
  }

  function lockControl(action) {
    if (action.restoreDisabled !== null
        || !(action.control instanceof HTMLButtonElement
          || action.control instanceof HTMLInputElement
          || action.control instanceof HTMLSelectElement
          || action.control instanceof HTMLTextAreaElement)) return;
    action.restoreDisabled = action.control.disabled;
    action.control.disabled = true;
    action.control.setAttribute("aria-busy", "true");
  }

  function unlockControl(action) {
    if (action.restoreDisabled === null) return;
    action.control.disabled = action.restoreDisabled;
    action.control.removeAttribute("aria-busy");
    action.restoreDisabled = null;
  }

  function requestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  }

  function errorMessage(response, payload) {
    const message = payload?.error
      || (Array.isArray(payload?.message) ? payload.message[0] : payload?.message);
    return typeof message === "string" && message.trim()
      ? message.trim()
      : `The request could not be completed (HTTP ${response.status}). Please try again.`;
  }

  window.fetch = async (input, init) => {
    const action = activeAction?.fetchAvailable ? activeAction : null;
    if (!action) return nativeFetch(input, init);

    action.fetchAvailable = false;
    if (action.pending === 0) {
      if (action.region) {
        action.region.hidden = true;
        action.region.textContent = "";
      }
    }
    const method = requestMethod(input, init);
    action.pending += 1;
    keepActionAvailable(action);
    const isWrite = method !== "GET" && method !== "HEAD";
    if (isWrite) {
      lockControl(action);
      renderFeedback(action, "info", "Working…");
      action.region?.setAttribute("aria-busy", "true");
    }

    try {
      const response = await nativeFetch(input, init);
      if (!response.ok) {
        let payload = {};
        try {
          payload = await response.clone().json();
        } catch {
          payload = {};
        }
        action.hasError = true;
        renderFeedback(action, "error", errorMessage(response, payload));
      } else {
        if (!action.hasError && isWrite) {
          renderFeedback(action, "success", "Request completed successfully.");
        }
      }
      return response;
    } catch (error) {
      action.hasError = true;
      renderFeedback(
        action,
        "error",
        error instanceof Error && error.message
          ? error.message
          : "The request failed. Check your connection and try again."
      );
      throw error;
    } finally {
      action.pending = Math.max(0, action.pending - 1);
      if (action.pending === 0) {
        unlockControl(action);
        action.region?.removeAttribute("aria-busy");
        keepActionAvailable(action);
      }
    }
  };

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("button")
      : null;
    if (!button || button.disabled || button.type === "reset") return;
    const form = button.closest("form");
    beginAction(form || button, form ? button : null);
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const action = beginAction(form, event.submitter);
    if (action?.region) {
      action.region.hidden = true;
      action.region.textContent = "";
    }
  }, true);

  document.addEventListener("change", (event) => {
    const target = event.target;
    const relevantControl = target instanceof HTMLSelectElement
      || (target instanceof HTMLInputElement && target.type === "file");
    if (!relevantControl) return;
    beginAction(target.closest("form") || target);
  }, true);

  document.addEventListener("invalid", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement
        || field instanceof HTMLSelectElement
        || field instanceof HTMLTextAreaElement)) return;
    const message = field.validationMessage;
    if (!message) return;
    if (activeAction?.target === field.form && activeAction.region) {
      activeAction.region.hidden = true;
      activeAction.region.textContent = "";
    }
    field.setAttribute("aria-invalid", "true");
    const label = field.closest("label");
    const container = label || field.parentElement;
    if (!container) return;
    let feedback = container.querySelector(":scope > .inline-field-feedback");
    if (!feedback) {
      feedback = document.createElement("span");
      feedback.className = "inline-field-feedback";
      feedback.id = `inline-field-feedback-${crypto.randomUUID()}`;
      feedback.setAttribute("role", "alert");
      container.append(feedback);
    }
    feedback.textContent = message;
    field.setAttribute("aria-describedby", [...new Set([
      field.getAttribute("aria-describedby"),
      feedback.id
    ].filter(Boolean).flatMap((value) => value.split(/\s+/)).filter(Boolean))].join(" "));
  }, true);

  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement
        || field instanceof HTMLSelectElement
        || field instanceof HTMLTextAreaElement)) return;
    queueMicrotask(() => {
      if (field.checkValidity()) clearFieldFeedback(field);
    });
  }, true);

  window.ChowkInlineFeedback = Object.freeze({
    clear,
    clearField: clearFieldFeedback,
    show
  });
})();
