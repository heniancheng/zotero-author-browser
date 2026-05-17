import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { onDialog as openAuthorDialog } from "./modules/authorBrowserDialog";
import {
  deleteABSavedSearches,
} from "./modules/authorBrowserAddon";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // @ts-ignore This is a moz feature
  window.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);

  // Wait for document to be ready
  await new Promise<void>(resolve => {
    if (document.readyState === "complete") {
      resolve();
    } else {
      window.addEventListener("load", () => resolve(), { once: true });
    }
  });

  // Give extra time for Zotero's UI to initialize
  await new Promise(resolve => setTimeout(resolve, 4000));

  // Register all UI elements
  await registerAllUIElements();

  setTimeout(() => {
    Zotero.debug("Author Browser: Plugin fully loaded, ready to use");
  }, 2000);
}

async function registerAllUIElements() {
  const mainWin = Zotero.getMainWindow();
  if (!mainWin) {
    Zotero.debug("Author Browser: Cannot get main window");
    return;
  }

  const doc = mainWin.document;

  // 1. Register keyboard shortcut (both XUL keyset and DOM keydown for reliability)
  registerKeyboardShortcut(doc);
  registerKeyboardShortcutFallback(doc);

  // 2. Register menu items with Zotero's native API
  await registerZoteroMenu(doc);

  // 3. Also try toolbar - multiple selectors
  addToolbarButton(doc);
}

function registerKeyboardShortcut(doc: Document) {
  // Check if already registered
  if (doc.querySelector("#author-browser-keyset")) {
    Zotero.debug("Author Browser: Keyboard already registered");
    return;
  }

  try {
    const keyset = doc.createElement("keyset");
    keyset.setAttribute("id", "author-browser-keyset");

    // Use Ctrl+Shift+A instead - less likely to conflict
    const key = doc.createElement("key");
    key.setAttribute("id", "author-browser-key-open");
    key.setAttribute("key", "A");
    key.setAttribute("modifiers", "accel,shift");
    key.setAttribute("oncommand", "void(0)");
    key.addEventListener("command", () => {
      Zotero.debug("Author Browser: Ctrl+Shift+A triggered - opening dialog");
      openAuthorDialog();
    });

    keyset.appendChild(key);
    doc.documentElement.appendChild(keyset);
    Zotero.debug("Author Browser: Keyboard registered (Ctrl+Shift+A)");
  } catch (e) {
    Zotero.debug("Author Browser: Keyboard registration failed: " + e);
  }
}

// Fallback keyboard handler using keydown event - works even if XUL keyset is intercepted
function registerKeyboardShortcutFallback(doc: Document) {
  if (doc.querySelector("#author-browser-fallback-listener")) {
    return;
  }

  try {
    doc.addEventListener("keydown", (event: KeyboardEvent) => {
      // Ctrl+Shift+A
      if (event.ctrlKey && event.shiftKey && event.key === "A") {
        event.preventDefault();
        Zotero.debug("Author Browser: Ctrl+Shift+A triggered (fallback) - opening dialog");
        openAuthorDialog();
      }
    });

    const marker = doc.createElement("div");
    marker.id = "author-browser-fallback-listener";
    marker.style.display = "none";
    doc.documentElement.appendChild(marker);
    Zotero.debug("Author Browser: Fallback keyboard listener registered");
  } catch (e) {
    Zotero.debug("Author Browser: Fallback keyboard registration failed: " + e);
  }
}

async function registerZoteroMenu(doc: Document) {
  // Try multiple selectors for different Zotero versions
  const menuSelectors = [
    "menupopup[id='menu_ToolsPopup']",  // Old Zotero
    "menupopup[id='tools-menu-popup']", // Zotero 6+
    "#tools-menu-popup",                 // Alternative
    "menupopup[id='menu_Tools_popup']", // Another variant
    "menupopup",                        // Fallback - any menupopup in tools menu
  ];

  for (let attempt = 1; attempt <= 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    let menuPopup: Element | null = null;

    // Try each selector
    for (const selector of menuSelectors) {
      menuPopup = doc.querySelector(selector);
      if (menuPopup) {
        Zotero.debug("Author Browser: Found menu with selector: " + selector);
        break;
      }
    }

    // If not found, try to find from Tools menu
    if (!menuPopup) {
      const toolsMenu = doc.querySelector("menuitem[label='Tools'], menu[id='menu_Tools'], menu[data-l10n-id='menu-tools']");
      if (toolsMenu) {
        menuPopup = toolsMenu.querySelector("menupopup");
        if (menuPopup) {
          Zotero.debug("Author Browser: Found menu from Tools menu element");
        }
      }
    }

    if (!menuPopup) {
      Zotero.debug("Author Browser: Menu not found, attempt " + attempt);
      continue;
    }

    // Check if already has items
    if (doc.querySelector("#author-browser-tool-menu-item")) {
      Zotero.debug("Author Browser: Menu exists");
      return;
    }

    try {
      // Create menu items
      const separator = doc.createElement("menuseparator");
      separator.id = "author-browser-separator";
      menuPopup.appendChild(separator);

      const menuItem = doc.createElement("menuitem");
      menuItem.id = "author-browser-tool-menu-item";
      menuItem.setAttribute("label", "Zotero Author Browser");
      menuItem.setAttribute("accesskey", "B");
      menuItem.addEventListener("command", () => openAuthorDialog());
      menuPopup.appendChild(menuItem);

      const clearItem = doc.createElement("menuitem");
      clearItem.id = "author-browser-tool-menu-clear-search";
      clearItem.setAttribute("label", "Clear Author Search");
      clearItem.addEventListener("command", () => deleteABSavedSearches());
      menuPopup.appendChild(clearItem);

      Zotero.debug("Author Browser: Native menu added");
      return;
    } catch (e) {
      Zotero.debug("Author Browser: Menu error: " + e);
    }
  }

  // Last resort: try to inject into the main menubar
  Zotero.debug("Author Browser: Trying to inject into main menubar");
  injectIntoMainMenubar(doc);
}

function injectIntoMainMenubar(doc: Document) {
  try {
    // Find the main menubar
    const menubar = doc.querySelector("menubar");
    if (!menubar) {
      Zotero.debug("Author Browser: No menubar found");
      return;
    }

    // Try to find or create Tools menu
    let toolsMenu = doc.querySelector("menu[data-l10n-id='menu-tools'], menu[label='Tools']");

    if (!toolsMenu) {
      // Insert a new menu
      toolsMenu = doc.createElement("menu");
      toolsMenu.setAttribute("label", "Tools");
      toolsMenu.setAttribute("data-l10n-id", "menu-tools");

      const menupopup = doc.createElement("menupopup");
      toolsMenu.appendChild(menupopup);
      menubar.appendChild(toolsMenu);

      // Add our menu items directly to the popup
      const separator = doc.createElement("menuseparator");
      separator.id = "author-browser-separator";
      menupopup.appendChild(separator);

      const menuItem = doc.createElement("menuitem");
      menuItem.id = "author-browser-tool-menu-item";
      menuItem.setAttribute("label", "Zotero Author Browser");
      menuItem.setAttribute("accesskey", "B");
      menuItem.addEventListener("command", () => openAuthorDialog());
      menupopup.appendChild(menuItem);

      const clearItem = doc.createElement("menuitem");
      clearItem.id = "author-browser-tool-menu-clear-search";
      clearItem.setAttribute("label", "Clear Author Search");
      clearItem.addEventListener("command", () => deleteABSavedSearches());
      menupopup.appendChild(clearItem);

      Zotero.debug("Author Browser: Menu injected into menubar");
    }
  } catch (e) {
    Zotero.debug("Author Browser: Menubar injection error: " + e);
  }
}

function addToolbarButton(doc: Document) {
  if (doc.querySelector("#author-browser-toolbar-button")) return;

  try {
    // Try multiple toolbar selectors for Zotero 9
    let toolbar = doc.querySelector("#zotero-toolbar") ||
                  doc.querySelector("toolbar[id='zotero-toolbar']") ||
                  doc.querySelector("toolbar.zotero-toolbar") ||
                  doc.querySelector("toolbar#main-toolbar");

    if (!toolbar) {
      // Try to find any visible toolbar
      const toolbars = doc.querySelectorAll("toolbar");
      for (const tb of Array.from(toolbars)) {
        const tbEl = tb as HTMLElement;
        if (tbEl.style.display !== 'none' && tbEl.id) {
          toolbar = tb as Element;
          Zotero.debug("Author Browser: Found toolbar: " + (tb as Element).id);
          break;
        }
      }
    }

    if (!toolbar) {
      Zotero.debug("Author Browser: No toolbar found");
      return;
    }

    Zotero.debug("Author Browser: Adding to toolbar: " + (toolbar as Element).tagName);

    const button = doc.createElement("toolbarbutton");
    button.id = "author-browser-toolbar-button";
    button.setAttribute("label", "Author Browser");
    button.setAttribute("tooltiptext", "Open Author Browser (Ctrl+Shift+A)");
    button.setAttribute("image", `chrome://zotero-author-browser/content/icons/favicon@0.5x.png`);
    button.classList.add("toolbarbutton-1", "zotero-toolbar-button");

    button.addEventListener("command", () => {
      Zotero.debug("Author Browser: Toolbar button clicked");
      openAuthorDialog();
    });

    toolbar.appendChild(button);
    Zotero.debug("Author Browser: Toolbar button added to " + toolbar.id);
  } catch (e) {
    Zotero.debug("Author Browser: Toolbar error: " + e);
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  deleteABSavedSearches();
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  deleteABSavedSearches();
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};