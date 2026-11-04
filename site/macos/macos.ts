import release from "./release.json";
const safeUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } };
const apple = safeUrl(release.appleSiliconUrl), universal = safeUrl(release.universalUrl), checksums = safeUrl(release.checksumsUrl), notes = safeUrl(release.releaseNotesUrl);
if (release.available && universal && checksums && notes) {
  const container = document.getElementById("mac-downloads")!;
  const webApp = container.querySelector("[data-open-app]");
  const guide = container.querySelector('a[href$="docs/macos/"]');
  container.replaceChildren(...(webApp ? [webApp] : []), ...[...(apple ? [{ href: apple, label: "Download for Apple Silicon", primary: true }] : []), { href: universal, label: "Download Universal · Intel + Apple Silicon", primary: !apple }].map(item => {
    const link = document.createElement("a"); link.className = `button${item.primary ? " primary" : ""}`; link.href = item.href; link.textContent = item.label; return link;
  }));
  if (guide) container.append(guide);
  const status = document.getElementById("mac-release-status")!;
  status.textContent = `Version ${release.version} · ${release.channel} · macOS 14 or later`;
  for (const [id, href] of [["mac-checksums", checksums], ["mac-notes", notes]] as const) {
    const link = document.getElementById(id) as HTMLAnchorElement; link.href = href!; link.hidden = false;
  }
}
