/// @ts-nocheck
import { getString, initLocale } from "../utils/locale";
import { onDialog } from "./authorBrowserDialog";
import { getPref, setPref } from "../utils/prefs";

export interface CreatorDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
  aliasIDs: Array<number>;
  aliasFullNames: Array<string>;
  aliasFullNamesString: string;
  itemCount: number;
}
export interface CreatorQueryDataRow {
  firstName: string;
  lastName: string;
  creatorID: number;
}

export function registerToolsMenuItem(): boolean {
  // Get main window document
  const mainWin = Zotero.getMainWindow();
  if (!mainWin) {
    Zotero.debug("Author Browser: Cannot get main window");
    return false;
  }
  const doc = mainWin.document;

  // Check if menu already exists
  if (doc.querySelector("#author-browser-tool-menu-item")) {
    Zotero.debug("Author Browser: Menu already exists, skipping");
    return true;
  }

  // Try to find menu using Zotero's internal methods first
  let menuPopup: Element | null = null;

  // Method 1: Try Zotero's menu registry
  try {
    if (mainWin.ZoteroMenu && mainWin.ZoteroMenu.menus) {
      Zotero.debug("Author Browser: Found Zotero menu registry");
    }
  } catch (e) {
    Zotero.debug("Author Browser: No Zotero menu registry: " + e);
  }

  // Method 2: Try finding via document query
  const menuSelectors = [
    "menuTools",
    "#menu_ToolsPopup",
    "menupopup[id='menu_ToolsPopup']",
    "menu[id='menu_Tools']",
    "#tools-menu",
    "menupopup.tools-menupopup",
  ];

  for (const selector of menuSelectors) {
    menuPopup = doc.querySelector(selector);
    if (menuPopup) break;
  }

  if (!menuPopup) {
    // Debug: List all menu elements in document
    const allMenus = doc.querySelectorAll("menu, menupopup, menubar > menu");
    Zotero.debug("Author Browser: All menus found: " + Array.from(allMenus).map(m => `${m.tagName}#${m.id}[class=${m.className}]`).join(", "));
    return false;
  }

  Zotero.debug("Author Browser: Found Tools menu: " + menuPopup.tagName);

  // Force menu to rebuild/refresh before adding items
  try {
    // Try calling rebuild if available
    if ((menuPopup as any).rebuild) {
      (menuPopup as any).rebuild();
    }
  } catch (e) {
    Zotero.debug("Author Browser: Could not rebuild menu: " + e);
  }

  // Create menu separator
  const separator = doc.createElement("menuseparator");
  menuPopup.appendChild(separator);

  // Create "Zotero Author Browser" menu item
  const menuItem = doc.createElement("menuitem");
  menuItem.setAttribute("id", "author-browser-tool-menu-item");
  menuItem.setAttribute("label", "Zotero Author Browser");
  menuItem.setAttribute("accesskey", "A");
  menuItem.addEventListener("command", (ev) => onDialog());
  menuPopup.appendChild(menuItem);

  // Create "Clear Search" menu item
  const clearItem = doc.createElement("menuitem");
  clearItem.setAttribute("id", "author-browser-tool-menu-clear-search");
  clearItem.setAttribute("label", "Clear Author Search");
  clearItem.addEventListener("command", (ev) => deleteABSavedSearches());
  menuPopup.appendChild(clearItem);

  // Verify items were added
  const addedItems = menuPopup.querySelectorAll("#author-browser-tool-menu-item, #author-browser-tool-menu-clear-search");
  Zotero.debug("Author Browser: Added " + addedItems.length + " menu items");

  // Force menu popup to update its display
  try {
    menuPopup.dispatchEvent(new Event("popupshowing", { bubbles: true }));
  } catch (e) {
    Zotero.debug("Author Browser: Could not dispatch popupshowing: " + e);
  }

  // Also try adding to toolbar as fallback
  const toolbar = doc.querySelector("#zotero-toolbar");
  if (toolbar) {
    const existingBtn = doc.querySelector("#author-browser-toolbar-button");
    if (!existingBtn) {
      Zotero.debug("Author Browser: Adding toolbar button");
      const button = doc.createElement("toolbarbutton");
      button.setAttribute("id", "author-browser-toolbar-button");
      button.setAttribute("label", "Author Browser");
      button.setAttribute("tooltiptext", "Open Author Browser");
      button.setAttribute("image", "chrome://zotero-author-browser/content/icons/favicon@0.5x.png");
      button.addEventListener("command", () => onDialog());
      toolbar.appendChild(button);
    }
  }

  return addedItems.length === 2;
}

export function registerCreatorTransformMenuItem() {
  const doc = ztoolkit.getGlobal("document");
  const menu = doc.querySelector("#zotero-creator-transform-menu") as Element;

  if (menu) {
    // Create separator
    const separator = doc.createElement("menuseparator");
    menu.appendChild(separator);

    // Create "Show Author" menu item
    const menuItem = doc.createElement("menuitem");
    menuItem.setAttribute("id", "zotero-show-author");
    menuItem.setAttribute("label", getString("show-author"));
    menuItem.addEventListener("command", async (ev) => showAuthorFromPopupMenu(ev));
    menu.appendChild(menuItem);
  }
}

export async function readCreatorAlias() {
  addon.data.authorAliases = JSON.parse(
    getPref("author-alias-db") as string,
  ) as AuthorAliases;
  removeInvalidAuthorAliases();
}

export async function saveCreatorAlias() {
  removeInvalidAuthorAliases();
  setPref("author-alias-db", JSON.stringify(addon.data.authorAliases));
}

export function makeAuthorAlias(mainID: number, aliasID: number) {
  if (addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1;
  }
  if (addon.data.authorAliases.aliasedCreatorIDs.includes(mainID)) {
    return 2;
  }
  addon.data.authorAliases.aliasedCreatorIDs.push(aliasID);
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == mainID,
  );
  if (alias.length == 0)
    addon.data.authorAliases.aliases.push({
      mainID: mainID,
      aliasIDs: [aliasID],
    });
  else alias[0].aliasIDs.push(aliasID);
  return 0;
}

export function removeAuthorAlias(mainID: number, aliasID: number) {
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(aliasID)) {
    return 1; // aliasID is not an aliased ID.
  }
  const mainIndex = addon.data.authorAliases.aliases.findIndex(
    (v, i, a) => v.mainID == mainID,
  );
  if (mainIndex == -1) {
    return 2; // mainID has no alias
  }
  if (!addon.data.authorAliases.aliases[mainIndex].aliasIDs.includes(aliasID)) {
    return 3; // aliasID is not an alias of mainID
  }
  addon.data.authorAliases.aliasedCreatorIDs =
    addon.data.authorAliases.aliasedCreatorIDs.filter(
      (v, i, n) => v != aliasID,
    );
  addon.data.authorAliases.aliases[mainIndex].aliasIDs =
    addon.data.authorAliases.aliases[mainIndex].aliasIDs.filter(
      (v, i, n) => v != aliasID,
    );
  addon.data.authorAliases.aliases = addon.data.authorAliases.aliases.filter(
    (v, i, n) => v.aliasIDs.length == 0,
  );
  return 0;
}

function removeInvalidAuthorAliases() {
  for (let i = 0; i < addon.data.authorAliases.aliases.length; i++) {
    const alias = addon.data.authorAliases.aliases[i];
    for (let j = 0; j < alias.aliasIDs.length; j++) {
      try {
        Zotero.Creators.get(alias.aliasIDs[j]);
        Zotero.Creators.get(alias.mainID);
      } catch {
        addon.data.authorAliases.aliases.filter((v, index, a) => index != i);
        addon.data.authorAliases.aliasedCreatorIDs.filter(
          (v, index, a) => v != alias.aliasIDs[j],
        );
      }
    }
  }
}

export async function getAllCreators(orderBy: "firstName"|"lastName"|"itemCount"|"creatorID", desc: boolean = false) {
  Zotero.debug("Author Browser: getAllCreators called, orderBy=" + orderBy + ", desc=" + desc);
  const doGetAllCreators = async function () {
    await Zotero.DB.requireTransaction();
    const sql = "SELECT creators.firstName, creators.lastName, creators.creatorID, COUNT(itemCreators.itemID) AS itemCount \
                 FROM creators \
                 JOIN itemCreators ON creators.creatorID = itemCreators.creatorID \
                 WHERE creators.fieldMode = 0 AND itemCreators.creatorTypeID = 8 \
                 GROUP BY itemCreators.creatorID \
                 ORDER BY " + orderBy + (desc ? " desc" : "");
    Zotero.debug("Author Browser: SQL: " + sql);
    const result = await Zotero.DB.queryAsync(sql);
    Zotero.debug("Author Browser: Query result rows: " + result?.length);

    return result;
  };

  const creators: CreatorDataRow[] = [];
  let rows;
  await Zotero.DB.executeTransaction(async function () {
    rows = await doGetAllCreators();
    Zotero.debug("Author Browser: Processing " + rows.length + " rows");
    for (let i = 0; i < rows.length; i++) {
      if(rows[i].itemCount == 0)
        continue;
      if (
        !addon.data.authorAliases.aliasedCreatorIDs.includes(rows[i].creatorID)
      ) {
        creators.push({
          firstName: rows[i].firstName,
          lastName: rows[i].lastName,
          creatorID: rows[i].creatorID,
          itemCount: rows[i].itemCount,
          aliasIDs: getAllAliasByMainID(rows[i].creatorID),
          aliasFullNames: [],
          aliasFullNamesString: "",
        });
      }
    }
  });
  Zotero.debug("Author Browser: Final creators list length: " + creators.length);
  removeInvalidAuthorAliases();
  for (let i = 0; i < addon.data.authorAliases.aliases.length; i++) {
    const alias = addon.data.authorAliases.aliases[i];
    const mainIndex = creators.findIndex(
      (v2, i2, a2) => v2.creatorID == alias.mainID,
    );
    for (let j = 0; j < alias.aliasIDs.length; j++) {
      const aliasCreator = Zotero.Creators.get(alias.aliasIDs[j]);
      creators[mainIndex].aliasFullNames.push(
        aliasCreator.firstName + " " + aliasCreator.lastName,
      );
      creators[mainIndex].aliasFullNamesString +=
        aliasCreator.firstName + " " + aliasCreator.lastName;
      if (i < addon.data.authorAliases.aliases.length - 1)
        creators[mainIndex].aliasFullNamesString += ", ";
      creators[mainIndex].itemCount +=
        await Zotero.Creators.countItemAssociations(alias.aliasIDs[j]);
    }
  }

  return creators;
}

export function getCreatorMainID(id: number) {
  if (!addon.data.authorAliases.aliasedCreatorIDs.includes(id)) return id;
  const aliases = addon.data.authorAliases.aliases.filter((v, i, a) =>
    v.aliasIDs.includes(id),
  );
  return aliases[0].mainID;
}

export function getAllAliasByMainID(mainID: number) {
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == mainID,
  );
  if (alias.length) return alias[0].aliasIDs;
  else return [];
}

export async function showAuthorByID(id: number) {
  const creator = Zotero.Creators.get(id);
  const fullName = creator.firstName + " " + creator.lastName;
  const s = new Zotero.Search({
    name: fullName,
    libraryID: Zotero.Libraries.userLibraryID,
  });
  s.addCondition("joinMode", "any");
  s.addCondition("creator", "is", creator.firstName + " " + creator.lastName);
  const alias = addon.data.authorAliases.aliases.filter(
    (v, i, a) => v.mainID == id,
  );
  if (alias.length != 0)
    alias[0].aliasIDs.forEach((v, i, a) => {
      const aliasCreator = Zotero.Creators.get(v);
      s.addCondition(
        "creator",
        "is",
        aliasCreator.firstName + " " + aliasCreator.lastName,
      );
    });
  //addAuthorSearchAndSelect(s);
  //showSearchToItemsView(s);
  saveSearchAndSelect(s);
}

export async function showAuthorFromPopupMenu(ev: Event) {
  let row;
  let fields;
  if (ev.target) {
    row = (ev.target as XULPopupElement).ownerDocument.popupNode.closest(
      ".meta-row",
    );
  } else {
    return;
  }
  if (ZoteroPane.itemPane) {
    fields = ZoteroPane.itemPane
      .querySelector("item-box")
      .getCreatorFields(row);
  }
  let id: number;
  await Zotero.DB.executeTransaction(async function () {
    id = await Zotero.Creators.getIDFromData({
      creatorType: Zotero.CreatorTypes.getName(fields.creatorTypeID),
      firstName: fields.firstName,
      lastName: fields.lastName,
    });
  });
  id = getCreatorMainID(id);
  showAuthorByID(id);
}
export async function deleteABSavedSearches() {
  const savedSearches = await Zotero.Searches.getAll(
    Zotero.Libraries.userLibraryID,
  )
    .filter((s) => !s.deleted)
    .filter((s) => (s.name as string).startsWith("[AB Temp]"));

  for (let i = 0; i < savedSearches.length; i++) {
    await savedSearches[i].erase();
  }
}

async function showSearchToItemsView(s: Zotero.Search) {
  const collectionTreeRow = {
    view: {},
    ref: s,
    visibilityGroup: "default",
    isSearchMode: () => true,
    getItems: async function () {
      const lib = Zotero.Libraries.get(Zotero.Libraries.userLibraryID);
      if (lib) await lib.waitForDataLoad("item");
      else return false;
      const ids = await s.search();
      return Zotero.Items.get(ids);
    },
    isLibrary: () => false,
    isCollection: () => false,
    isSearch: () => true,
    isPublications: () => false,
    isDuplicates: () => false,
    isFeed: () => false,
    isFeeds: () => false,
    isFeedsOrFeed: () => false,
    isShare: () => false,
    isTrash: () => false,
  };
  const itemsView = ZoteroPane.itemsView;
  if (itemsView) itemsView.changeCollectionTreeRow(collectionTreeRow);
  else return;
  if (ZoteroPane.collectionsView)
    await ZoteroPane.collectionsView.selection.clearSelection();
  else return;
  (document.getElementById("item-tree-main-default") as XULTreeElement).focus();
  ZoteroPane.collectionsView.runListeners("select");
}

async function saveSearchAndSelect(s: Zotero.Search) {
  deleteABSavedSearches();
  s.name = "[AB Temp] " + s.name;
  await s.save();
  const savedSearches = Zotero.Searches.getAll(
    Zotero.Libraries.userLibraryID,
  ).filter((s) => !s.deleted);
  for (let i = 0; i < savedSearches.length; i++) {
    if (savedSearches[i].name == s.name) {
      ZoteroPane.collectionsView.selectItem(savedSearches[i].id);
    }
  }
}
