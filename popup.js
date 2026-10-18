// Popup script — runs with full chrome.* access (MV3 forbids inline scripts)
const manifest = chrome.runtime.getManifest();

const btn = document.getElementById("btn");
const output = document.getElementById("output");

btn.addEventListener("click", () => {
  output.textContent = [
    "✅ Hello World funcionando!",
    `🧩 ${manifest.name} v${manifest.version}`,
    `🆔 ID: ${chrome.runtime.id}`,
    `🕒 ${new Date().toLocaleString("pt-BR")}`,
  ].join("\n");
  output.style.display = "block";
});
