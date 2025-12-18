import os = require('os');
import path = require('path');
import { StatusBar, By, WebElement, InputBox, TextEditor, Workbench, VSBrowser, EditorView } from 'vscode-extension-tester';
import { Key } from 'selenium-webdriver';
import * as fs from 'fs';

/**
 * Best-effort: close any blocking modal/dialog (macOS flake)
 */
export async function dismissBlockingModal(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  try {
    const modals = await driver.findElements(By.css('.monaco-dialog-modal-block.dimmed'));
    if (modals.length > 0) {
      // On macOS, try clicking "Don't Save" button first
      if (process.platform === 'darwin') {
        try {
          const dontSaveButtons = await driver.findElements(
            By.xpath("//a[contains(@class, 'monaco-button') and contains(text(), \"Don't Save\")]")
          );
          if (dontSaveButtons.length > 0) {
            await dontSaveButtons[0].click();
            await new Promise((resolve) => setTimeout(resolve, 300));
            return;
          }
        } catch {
          // If button not found, fall back to ESC
        }
      }
      // Fall back to ESC key
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch {
    // ignore
  }
}

/**
 * Force close all editors without saving (macOS-safe)
 */
export async function forceCloseAllEditors(): Promise<void> {
  const driver = VSBrowser.instance.driver;

  // Dismiss any save modals first
  for (let i = 0; i < 3; i++) {
    await dismissBlockingModal();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    await new EditorView().closeAllEditors();
  } catch {
    // If normal close fails, try keyboard shortcut
    if (process.platform === 'darwin') {
      await driver.actions().keyDown(Key.COMMAND).sendKeys('w').keyUp(Key.COMMAND).perform();
    } else {
      await driver.actions().keyDown(Key.CONTROL).sendKeys('w').keyUp(Key.CONTROL).perform();
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  await dismissBlockingModal();
}

/**
 * Create file on disk and open it through "File: Open File..."
 * This avoids the flaky ">new file" command flow that can trigger Save As modals on macOS.
 */
export async function createCustomFile(filePath: string): Promise<TextEditor> {
  const driver = VSBrowser.instance.driver;

  // First, force close all editors and dismiss any modals to start fresh
  await forceCloseAllEditors();

  // Ensure the file exists on disk with empty content
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');

  const wb = new Workbench();

  // Retry opening command prompt if modal blocks it
  let input: InputBox | undefined;
  for (let i = 0; i < 3; i++) {
    try {
      await dismissBlockingModal();
      await wb.openCommandPrompt();
      input = await InputBox.create();
      break;
    } catch (e) {
      if (i === 2) throw e;
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!input) {
    throw new Error('Failed to open command prompt');
  }

  // Use the built-in command that opens an existing file
  await input.setText('File: Open File...');
  await input.confirm();

  // The quick input switches to a path prompt
  input = await InputBox.create();
  await input.setText(filePath);
  await input.confirm();

  const editor = new TextEditor();
  await editor.click(); // ensure focus

  // Don't save here - let the test control when to save
  return editor;
}

export function deleteFileInHomeDir(filename: string): void {
  const homeDir = os.homedir();
  const pathtofile = path.join(homeDir, filename);

  if (fs.existsSync(pathtofile)) {
    fs.rmSync(pathtofile, { recursive: true, force: true });
  }
}

export async function getSchemaLabel(text: string): Promise<WebElement | undefined> {
  const schemalabel = await new StatusBar().findElements(By.xpath('.//a[@aria-label="' + text + ', Select JSON Schema"]'));
  return schemalabel[0];
}

export async function hardDelay(milliseconds: number): Promise<number> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
