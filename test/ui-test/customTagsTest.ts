import os = require('os');
import path = require('path');
import { expect } from 'chai';
import { By, WebDriver, TextEditor, Workbench, ContentAssist, EditorView, VSBrowser } from 'vscode-extension-tester';
import { Key } from 'selenium-webdriver';
import { createCustomFile, deleteFileInHomeDir, getSchemaLabel, hardDelay, forceCloseAllEditors } from './util/utility';

/**
 * @author Zbynek Cervinka <zcervink@redhat.com>
 * @author Ondrej Dockal <odockal@redhat.com>
 */
export function customTagsTest(): void {
  describe("Verify extension's custom tags", () => {
    let driver: WebDriver;
    const yamlFileName = 'kustomization.yaml';
    const homeDir = os.homedir();
    const yamlFilePath = path.join(homeDir, yamlFileName);
    let editor: TextEditor;
    let editorView: EditorView;

    before(async function setup() {
      this.timeout(20000);
      driver = VSBrowser.instance.driver;
      editorView = new EditorView();
      await createCustomFile(yamlFilePath);
      await driver.wait(async () => {
        return await getSchemaLabel(yamlFileName);
      }, 18000);
    });

    it('YAML custom tags works as expected', async function () {
      this.timeout(60000);

      const settingsEditor = await new Workbench().openSettings();
      const setting = await settingsEditor.findSetting('Custom Tags', 'Yaml');
      await setting.findElement(By.className('edit-in-settings-button')).click();

      await hardDelay(4000);
      const textSettingsEditor = (await editorView.openEditor('settings.json')) as TextEditor;
      
      // Dismiss any auto-opened content assist
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await hardDelay(500);
      
      // Get the full text to find the yaml.customTags line
      const fullText = await textSettingsEditor.getText();
      const lines = fullText.split('\n');
      
      // Find the line with "yaml.customTags": [
      let targetLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('"yaml.customTags"') && lines[i].includes('[')) {
          targetLine = i + 2; // Position on the line after the opening bracket
          break;
        }
      }
      
      if (targetLine === -1) {
        expect.fail('Could not find yaml.customTags in settings.json');
      }
      
      // Click to ensure focus and position cursor
      await textSettingsEditor.click();
      await hardDelay(300);
      
      // Type at the correct position (inside the array)
      await textSettingsEditor.typeTextAt(targetLine, 5, '"customTag1"');
      await textSettingsEditor.save();
      
      // Give more time for settings to be processed
      await hardDelay(3_000);

      editor = (await editorView.openEditor(yamlFileName)) as TextEditor;
      await editor.click();
      
      // Clear any existing content first
      await editor.setText('');
      await hardDelay(500);
      
      // Use typeTextAt like the working autocompletion test - this triggers language server properly
      await editor.typeTextAt(1, 1, 'custom');
      
      // Give language server time to process the custom tag
      await hardDelay(1000);

      // toggleContentAssist will trigger the suggestions
      const contentAssist = await editor.toggleContentAssist(true);

      if (!(contentAssist instanceof ContentAssist)) {
        expect.fail("Content assist widget did not appear.");
      }

      // Wait for the widget to be visible and have items
      await driver.wait(async () => {
        try {
          const widget = await driver.findElement(By.className('suggest-widget'));
          return await widget.isDisplayed();
        } catch {
          return false;
        }
      }, 10000, 'Suggest widget did not become visible');

      // Wait for suggestion rows to appear
      await driver.wait(async () => {
        const rows = await driver.findElements(By.css('.suggest-widget .monaco-list-row'));
        return rows.length > 0;
      }, 10000, 'No suggestion rows appeared');

      // Get all suggestion labels directly from DOM
      const labelEls = await driver.findElements(By.css('.suggest-widget .monaco-list-row .label-name'));
      const items = await Promise.all(labelEls.map(async (el) => el.getText()));

      if (!items.includes('customTag1')) {
        expect.fail("The 'customTag1' custom tag did not appear in the content assist's suggestion list. Found: " + items.join(', '));
      }
      
      // Save to prevent "Do you want to save?" modal
      await editor.save();
    });

    after(async function () {
      this.timeout(15000);
      try {
        await forceCloseAllEditors();
      } catch {
        // ignore close failures in cleanup
      }
      deleteFileInHomeDir(yamlFileName);
    });
  });
}
