import { App, moment, Notice, PluginSettingTab, SettingDefinitionItem } from 'obsidian'
import ImmichPicker from './main'

export type GetDateFromOption = 'none' | 'title' | 'frontmatter';

export interface ImmichPickerSettings {
  serverUrl: string;
  apiKey: string;
  recentPhotosCount: number;
  gridColumns: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  filename: string;
  thumbnailMarkdown: string;
  locationOption: string;
  locationFolder: string;
  locationSubfolder: string;
  convertPastedLink: boolean;
  getDateFrom: GetDateFromOption;
  getDateFromFrontMatterKey: string;
  getDateFromFormat: string;
}

export const DEFAULT_SETTINGS: ImmichPickerSettings = {
  serverUrl: '',
  apiKey: '',
  recentPhotosCount: 9,
  gridColumns: 3,
  thumbnailWidth: 400,
  thumbnailHeight: 280,
  filename: '[immich_]YYYY-MM-DD--HH-mm-ss[.jpg]',
  thumbnailMarkdown: '[![]({{local_thumbnail_link}})]({{immich_url}}) ',
  locationOption: 'note',
  locationFolder: '',
  locationSubfolder: 'photos',
  convertPastedLink: true,
  getDateFrom: 'none',
  getDateFromFrontMatterKey: 'date',
  getDateFromFormat: 'YYYY-MM-DD'
}

export class ImmichPickerSettingTab extends PluginSettingTab {
  plugin: ImmichPicker

  constructor (app: App, plugin: ImmichPicker) {
    super(app, plugin)
    this.plugin = plugin
  }

  /**
   * Declarative settings. Returning a non-empty array makes Obsidian render
   * the tab from these definitions and index them for settings search.
   */
  getSettingDefinitions (): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Immich server connection',
        items: [
          {
            name: 'Server URL',
            desc: 'The URL of your Immich server (e.g., https://immich.example.com)',
            control: {
              type: 'text',
              key: 'serverUrl',
              placeholder: 'https://immich.example.com',
              defaultValue: DEFAULT_SETTINGS.serverUrl
            }
          },
          {
            name: 'API key',
            desc: createFragment(frag => {
              frag.appendText('Generate in Immich under Account Settings > API Keys.')
              frag.createEl('br')
              frag.appendText('Required permissions: ')
              frag.createEl('code', { text: 'asset.read' })
              frag.appendText(', ')
              frag.createEl('code', { text: 'asset.view' })
              frag.createEl('br')
              frag.appendText('Optional for albums: ')
              frag.createEl('code', { text: 'album.read' })
            }),
            control: {
              type: 'text',
              key: 'apiKey',
              placeholder: 'Enter your API key',
              defaultValue: DEFAULT_SETTINGS.apiKey
            }
          },
          {
            name: 'Test connection',
            desc: 'Test your connection to the Immich server.',
            render: setting => {
              setting.addButton(btn => btn
                .setButtonText('Test connection')
                .setCta()
                .onClick(() => void this.testConnection()))
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Photo picker',
        items: [
          {
            name: 'Photos per page',
            desc: 'Number of photos to load at a time (recent, search results, and "load next")',
            control: {
              type: 'number',
              key: 'recentPhotosCount',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.recentPhotosCount
            }
          },
          {
            name: 'Grid columns',
            desc: 'Number of columns in the photo grid',
            control: {
              type: 'number',
              key: 'gridColumns',
              min: 1,
              max: 10,
              defaultValue: DEFAULT_SETTINGS.gridColumns
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Note date detection',
        items: [
          {
            name: 'Get date from',
            desc: 'Where to extract the date for filtering photos',
            control: {
              type: 'dropdown',
              key: 'getDateFrom',
              options: {
                none: 'Disabled',
                title: 'Note title',
                frontmatter: 'Frontmatter property'
              },
              defaultValue: DEFAULT_SETTINGS.getDateFrom
            }
          },
          {
            name: 'Frontmatter key',
            desc: 'The frontmatter property containing the date',
            visible: () => this.plugin.settings.getDateFrom === 'frontmatter',
            control: {
              type: 'text',
              key: 'getDateFromFrontMatterKey',
              placeholder: DEFAULT_SETTINGS.getDateFromFrontMatterKey,
              defaultValue: DEFAULT_SETTINGS.getDateFromFrontMatterKey
            }
          },
          {
            name: 'Date format',
            desc: createFragment(frag => {
              frag.appendText('Expected date format in title/frontmatter (')
              frag.createEl('a', {
                text: 'Moment.js format',
                href: 'https://momentjs.com/docs/#/displaying/format/'
              })
              frag.appendText(').')
            }),
            visible: () => this.plugin.settings.getDateFrom !== 'none',
            control: {
              type: 'text',
              key: 'getDateFromFormat',
              placeholder: DEFAULT_SETTINGS.getDateFromFormat,
              defaultValue: DEFAULT_SETTINGS.getDateFromFormat
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Thumbnails',
        items: [
          {
            name: 'Thumbnail width',
            desc: 'Maximum width of the locally-saved thumbnail image in pixels',
            control: {
              type: 'number',
              key: 'thumbnailWidth',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.thumbnailWidth
            }
          },
          {
            name: 'Thumbnail height',
            desc: 'Maximum height of the locally-saved thumbnail image in pixels',
            control: {
              type: 'number',
              key: 'thumbnailHeight',
              min: 1,
              defaultValue: DEFAULT_SETTINGS.thumbnailHeight
            }
          },
          {
            // Rendered imperatively to keep the live filename preview.
            name: 'Image filename format',
            render: setting => {
              setting.descEl.appendText('Filename format for saving thumbnails (')
              setting.descEl.createEl('a', {
                text: 'Moment.js format',
                href: 'https://momentjs.com/docs/#/displaying/format/'
              })
              setting.descEl.appendText(').')
              setting.descEl.createEl('br')
              setting.descEl.createEl('br')
              setting.descEl.appendText('Preview: ')
              const previewEl = setting.descEl.createEl('code', { cls: 'immich-filename-preview' })
              this.updateFilenamePreview(previewEl, this.plugin.settings.filename)

              setting.addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.filename)
                .setValue(this.plugin.settings.filename)
                .onChange(async value => {
                  this.plugin.settings.filename = value.trim()
                  await this.plugin.saveSettings()
                  this.updateFilenamePreview(previewEl, value.trim())
                }))
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Storage location',
        items: [
          {
            name: 'Location to save thumbnails',
            desc: 'Where the local thumbnail images will be saved',
            control: {
              type: 'dropdown',
              key: 'locationOption',
              options: {
                note: 'Same folder as the note',
                subfolder: 'In a subfolder of the current note',
                specified: 'In a specific folder'
              },
              defaultValue: DEFAULT_SETTINGS.locationOption
            }
          },
          {
            name: 'Thumbnail image folder',
            desc: 'Thumbnails will be saved to this folder',
            visible: () => this.plugin.settings.locationOption === 'specified',
            control: {
              type: 'folder',
              key: 'locationFolder',
              placeholder: 'Path/for/thumbnails',
              defaultValue: DEFAULT_SETTINGS.locationFolder
            }
          },
          {
            name: 'Subfolder name',
            desc: 'Subfolder within the current note\'s folder',
            visible: () => this.plugin.settings.locationOption === 'subfolder',
            control: {
              type: 'text',
              key: 'locationSubfolder',
              placeholder: 'Photos',
              defaultValue: DEFAULT_SETTINGS.locationSubfolder
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Output format',
        // Keeps the `.immich-picker-settings textarea` rule in styles.css applying.
        cls: 'immich-picker-settings',
        items: [
          {
            name: 'Inserted Markdown',
            desc: createFragment(frag => {
              frag.appendText('The Markdown text inserted when adding a photo. Available variables:')
              const ul = frag.createEl('ul')
              ul.createEl('li', { text: 'local_thumbnail_link - path to the local thumbnail' })
              ul.createEl('li', { text: 'immich_url - URL to the photo in Immich' })
              ul.createEl('li', { text: 'immich_asset_id - the Immich asset ID' })
              ul.createEl('li', { text: 'original_filename - original filename from Immich' })
              ul.createEl('li', { text: 'taken_date - date the photo was taken' })
              ul.createEl('li', { text: 'description - photo description from Immich' })
            }),
            control: {
              type: 'textarea',
              key: 'thumbnailMarkdown',
              placeholder: DEFAULT_SETTINGS.thumbnailMarkdown,
              defaultValue: DEFAULT_SETTINGS.thumbnailMarkdown
            }
          },
          {
            name: 'Convert pasted Immich links',
            desc: createFragment(frag => {
              frag.appendText('When pasting an Immich photo URL (e.g., ')
              frag.createEl('code', { text: 'https://immich.example.com/photos/abc-123' })
              frag.appendText('), automatically download the thumbnail and insert it as markdown instead of pasting the plain URL.')
            }),
            control: {
              type: 'toggle',
              key: 'convertPastedLink',
              defaultValue: DEFAULT_SETTINGS.convertPastedLink
            }
          }
        ]
      }
    ]
  }

  getControlValue (key: string): unknown {
    return this.plugin.settings[key as keyof ImmichPickerSettings]
  }

  async setControlValue (key: string, value: unknown): Promise<void> {
    const normalized = typeof value === 'string' ? this.normalize(key, value) : value
    Object.assign(this.plugin.settings, { [key]: normalized })
    await this.plugin.saveSettings()

    // These two drive the `visible` predicates of other settings.
    if (key === 'getDateFrom' || key === 'locationOption') {
      this.refreshDomState()
    }
  }

  /** Mirrors the input cleanup the imperative display() fallback performs. */
  private normalize (key: string, value: string): string {
    switch (key) {
      case 'serverUrl':
        return value.trim().replace(/\/+$/, '')
      case 'locationSubfolder':
        return value.trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
      case 'apiKey':
      case 'filename':
      case 'getDateFromFrontMatterKey':
      case 'getDateFromFormat':
        return value.trim()
      default:
        return value
    }
  }

  private async testConnection (): Promise<void> {
    try {
      const result = await this.plugin.immichApi.testConnection()
      if (result) {
        new Notice('Connection successful!')
      } else {
        new Notice('Connection failed. Check your server URL and API key.')
      }
    } catch (e) {
      new Notice('Connection failed: ' + (e as Error).message)
    }
  }

  updateFilenamePreview (el: HTMLElement, format: string): void {
    el.removeClass('is-muted', 'is-error')
    if (!format.trim()) {
      el.setText('Enter a format')
      el.addClass('is-muted')
      return
    }
    try {
      const preview = moment().format(format)
      el.setText(preview)
    } catch {
      el.setText('Invalid format')
      el.addClass('is-error')
    }
  }
}
