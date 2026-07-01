"use strict";

const obsidian_1 = require("obsidian");

// ─── Confirmation Modal ───────────────────────────────────────────────────────

class StndConfirmModal extends obsidian_1.Modal {
  constructor(app, message, confirmText, onConfirm, onCancel) {
    super(app);
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel || (() => {});
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("stnd-modal");

    // Split on literal \n so callers can use \n for line breaks
    this.message.split("\n").forEach((line, i) => {
      const el = contentEl.createEl(i === 0 ? "p" : "p", {
        text: line,
        cls: i === 0 ? "stnd-modal-message" : "stnd-modal-detail",
      });
    });

    const btns = contentEl.createEl("div", { cls: "stnd-modal-btns" });

    const cancelBtn = btns.createEl("button", {
      text: "Cancel",
      cls: "stnd-modal-btn-cancel",
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
      this.onCancel();
    });

    const confirmBtn = btns.createEl("button", {
      text: this.confirmText,
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = { StndConfirmModal };
