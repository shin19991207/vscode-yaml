import os = require('os');
import path = require('path');
import * as fs from 'fs';
import { expect } from 'chai';
import { WebDriver, VSBrowser, ContentAssist, EditorView, TextEditor, By } from 'vscode-extension-tester';
import { Key } from 'selenium-webdriver';
import { createCustomFile, deleteFileInHomeDir, getSchemaLabel, hardDelay, forceCloseAllEditors } from './util/utility';

async function takeScreenshot(driver: WebDriver, name: string): Promise<void> {
  const dir = path.join(process.cwd(), 'test-resources', 'screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const png = await driver.takeScreenshot();
  const filePath = path.join(dir, `${name}.png`);
  fs.writeFileSync(filePath, png, 'base64');
  // eslint-disable-next-line no-console
  console.log(`Saved screenshot: ${filePath}`);
}

// Wait for editor to be interactable (more reliable than schema label on macOS)
async function waitForEditorReady(driver: WebDriver, editorView: EditorView, fileName: string, timeoutMs: number): Promise<void> {
  await driver.wait(
    async () => {
      try {
        const ed = (await editorView.openEditor(fileName)) as TextEditor;
        await ed.click();
        return true;
      } catch {
        return false;
      }
    },
    timeoutMs,
    `Editor for ${fileName} was not ready within ${timeoutMs}ms`
  );
}

// Best-effort close any modal that could block clicks (Save As, dialogs)
async function dismissBlockingModal(driver: WebDriver): Promise<void> {
  try {
    const modals = await driver.findElements(By.css('.monaco-dialog-modal-block.dimmed'));
    if (modals.length > 0) {
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await hardDelay(250);
    }
  } catch {
    // ignore cleanup failures
  }
}

/**
 * @author Zbynek Cervinka <zcervink@redhat.com>
 * @author Ondrej Dockal <odockal@redhat.com>
 */
export function contentAssistSuggestionTest(): void {
  describe('Verify content assist suggests right sugestion', () => {
    let driver: WebDriver;
    const yamlFileName = 'kustomization.yaml';
    const homeDir = os.homedir();
    const yamlFilePath = path.join(homeDir, yamlFileName);

    before(async function setup() {
      // macOS + VS Code startup + schema resolution can exceed 20s
      this.timeout(90000);

      driver = VSBrowser.instance.driver;
      const editorView = new EditorView();

      await takeScreenshot(driver, 'contentAssist-before-createCustomFile');

      try {
        await createCustomFile(yamlFilePath);
      } catch (e) {
        await takeScreenshot(driver, 'contentAssist-createCustomFile-failed');
        throw e;
      }

      await takeScreenshot(driver, 'contentAssist-after-createCustomFile');

      // Prefer "editor is ready" instead of waiting on schema label (schema label is flaky on macOS)
      try {
        await waitForEditorReady(driver, editorView, yamlFileName, 45000);
      } catch (e) {
        await takeScreenshot(driver, 'contentAssist-editor-not-ready');
        throw e;
      }

      // Optional: still try schema label (non-fatal) just for debugging
      try {
        await driver.wait(async () => {
          try {
            const label = await getSchemaLabel(yamlFileName);
            return Boolean(label);
          } catch {
            return false;
          }
        }, 5000);
      } catch {
        // ignore; schema label is not required for content assist to work
      }

      // Small settle delay helps macOS flakiness
      await hardDelay(500);
    });

    it('Content assist suggests right suggestion', async function () {
      this.timeout(45000);

      const editorView = new EditorView();

      const tryOnce = async (attemptName: string) => {
        await dismissBlockingModal(driver);

        // Re-acquire the editor handle each time (prevents stale references)
        const textEditor = (await editorView.openEditor(yamlFileName)) as TextEditor;

        await textEditor.click();

        // Use typeTextAt like the working autocompletion test - this triggers language server properly
        try {
          await textEditor.typeTextAt(1, 1, 'api');
        } catch (e: any) {
          await takeScreenshot(driver, `contentAssist-typeText-failed-${attemptName}`);
          throw e;
        }

        // toggleContentAssist will trigger the suggestions - no need for manual Ctrl+Space
        const contentAssist = await textEditor.toggleContentAssist(true);

        if (contentAssist instanceof ContentAssist) {
          const hasItem = await contentAssist.hasItem('apiVersion');
          if (!hasItem) {
            await takeScreenshot(driver, `contentAssist-no-apiVersion-${attemptName}`);
            expect.fail("The 'apiVersion' string did not appear in the content assist's suggestion list.");
          }
        } else {
          await takeScreenshot(driver, `contentAssist-no-widget-${attemptName}`);
          expect.fail("The 'apiVersion' string did not appear in the content assist's suggestion list.");
        }
        
        // Save to prevent "Do you want to save?" modal
        await textEditor.save();
      };

      try {
        await tryOnce('first');
      } catch (e: any) {
        // One retry on stale elements (VS Code DOM re-renders a lot)
        if (e?.name === 'StaleElementReferenceError') {
          await tryOnce('retry');
        } else {
          throw e;
        }
      }
    });

    afterEach(async function () {
      this.timeout(10000);
      try {
        // Ensure file is saved after each test to prevent modals
        const editorView = new EditorView();
        const textEditor = (await editorView.openEditor(yamlFileName)) as TextEditor;
        await textEditor.save();
      } catch {
        // ignore if editor not available
      }
    });

    after(async function () {
      this.timeout(20000);
      try {
        await forceCloseAllEditors();
      } catch {
        // ignore close failures in cleanup
      }
      deleteFileInHomeDir(yamlFileName);
    });
  });
}
