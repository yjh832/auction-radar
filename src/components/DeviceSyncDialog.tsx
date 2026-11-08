import { useEffect, useState } from "react";
import { Copy, Link2, QrCode, Share2, X } from "lucide-react";
import {
  buildHoldingsSyncUrl,
  clearSyncHash,
  decryptHoldings,
  encryptHoldings,
  extractHoldingsSyncToken,
  tokenFromCurrentLocation
} from "../lib/deviceSync";
import type { HoldingPosition } from "../types";

interface DeviceSyncDialogProps {
  holdings: HoldingPosition[];
  onClose: () => void;
  onImport: (holdings: HoldingPosition[], mode: "merge" | "replace") => void;
}

export function DeviceSyncDialog({
  holdings,
  onClose,
  onImport
}: DeviceSyncDialogProps) {
  const initialToken = tokenFromCurrentLocation();
  const [mode, setMode] = useState<"export" | "import">(
    initialToken ? "import" : "export"
  );
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState(initialToken ?? "");
  const [syncUrl, setSyncUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function generateSync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (holdings.length === 0) {
        throw new Error("当前设备还没有持仓。请先添加持仓，或切换到“接收另一台设备”。");
      }
      const QRCode = (await import("qrcode")).default;
      const token = await encryptHoldings(holdings, password);
      const url = buildHoldingsSyncUrl(token);
      const image = await QRCode.toDataURL(url, {
        width: 340,
        margin: 1,
        errorCorrectionLevel: "L",
        color: { dark: "#102A43", light: "#F9FCFF" }
      });
      setSyncUrl(url);
      setQrDataUrl(image);
      setMessage("同步二维码已生成，请用另一台手机的系统相机扫码。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成同步二维码失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!syncUrl) return;
    try {
      await navigator.clipboard.writeText(syncUrl);
      setMessage("加密同步链接已复制。");
    } catch {
      setError("复制失败，请手动选择链接复制。");
    }
  }

  async function shareLink() {
    if (!syncUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: "竞价雷达持仓同步",
        text: "打开链接并输入同步口令，即可导入持仓。",
        url: syncUrl
      });
    } else {
      await copyLink();
    }
  }

  async function importSync(importMode: "merge" | "replace") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const token = extractHoldingsSyncToken(tokenInput);
      const imported = await decryptHoldings(token, password);
      onImport(imported, importMode);
      clearSyncHash();
      setMessage(
        importMode === "replace"
          ? `已覆盖导入 ${imported.length} 只持仓。`
          : `已合并导入 ${imported.length} 只持仓。`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败，请检查同步码和口令");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-sync-root" role="presentation">
      <button
        className="device-sync-backdrop"
        type="button"
        aria-label="关闭设备同步"
        onClick={() => {
          clearSyncHash();
          onClose();
        }}
      />
      <section
        className="device-sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设备间同步持仓"
      >
        <header>
          <div>
            <span>ENCRYPTED DEVICE SYNC</span>
            <h2>设备间同步持仓</h2>
            <p>二维码和链接均使用 AES-GCM 加密。另一台设备输入相同口令即可导入。</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => {
              clearSyncHash();
              onClose();
            }}
          >
            <X size={20} />
          </button>
        </header>

        <div className="device-sync-tabs">
          <button
            type="button"
            className={mode === "export" ? "is-active" : ""}
            onClick={() => setMode("export")}
          >
            <QrCode size={16} />
            发送到另一台设备
          </button>
          <button
            type="button"
            className={mode === "import" ? "is-active" : ""}
            onClick={() => setMode("import")}
          >
            <Link2 size={16} />
            接收另一台设备
          </button>
        </div>

        {mode === "export" ? (
          <div className="device-sync-panel">
            <label>
              设置一次性同步口令
              <input
                type="password"
                value={password}
                placeholder="至少6位，由你自行设置"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="device-sync-primary"
              onClick={() => void generateSync()}
              disabled={busy}
            >
              <QrCode size={16} />
              {busy ? "正在加密" : "生成加密同步二维码"}
            </button>
            {qrDataUrl && (
              <div className="device-sync-qr">
                <img src={qrDataUrl} alt="持仓同步二维码" />
                <div>
                  <strong>用另一台设备扫码</strong>
                  <p>手机可使用系统相机扫码打开；电脑可复制链接后发送到另一台设备。</p>
                  <div>
                    <button type="button" onClick={() => void copyLink()}>
                      <Copy size={14} />
                      复制链接
                    </button>
                    <button type="button" onClick={() => void shareLink()}>
                      <Share2 size={14} />
                      系统分享
                    </button>
                  </div>
                </div>
                <textarea readOnly value={syncUrl} aria-label="加密同步链接" />
              </div>
            )}
          </div>
        ) : (
          <div className="device-sync-panel">
            <label>
              粘贴同步链接或同步码
              <textarea
                value={tokenInput}
                placeholder="粘贴另一台设备生成的链接或同步码"
                onChange={(event) => setTokenInput(event.target.value)}
              />
            </label>
            <label>
              输入同步口令
              <input
                type="password"
                value={password}
                placeholder="与另一台设备设置的口令相同"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="device-sync-import-actions">
              <button
                type="button"
                className="device-sync-primary"
                onClick={() => void importSync("merge")}
                disabled={busy || !tokenInput.trim() || !password}
              >
                合并导入
              </button>
              <button
                type="button"
                onClick={() => void importSync("replace")}
                disabled={busy || !tokenInput.trim() || !password}
              >
                覆盖本机持仓
              </button>
            </div>
          </div>
        )}

        {message && <div className="device-sync-message">{message}</div>}
        {error && <div className="device-sync-error">{error}</div>}
        <p className="device-sync-note">
          纯静态网页无法在局域网中自动发现另一台设备，所以采用更安全的加密二维码/链接同步。同步完成后，两端各自保存；后续修改可再次生成二维码。
        </p>
      </section>
    </div>
  );
}
