import { moment, requestUrl } from 'obsidian'
import ImmichPicker from './main'

export interface ImmichAsset {
  id: string;
  originalFileName: string;
  fileCreatedAt: string;
  type: string;
  description?: string;
  visibility?: string;
  livePhotoVideoId?: string | null;
}

export interface ImmichAssetDetails {
  id: string;
  originalFileName?: string;
  fileCreatedAt?: string;
  exifInfo?: {
    description?: string;
    exifImageWidth?: number;
    exifImageHeight?: number;
  };
}

export interface ImmichSearchResponse {
  assets: {
    items: ImmichAsset[];
    count: number;
    nextPage?: string | number | null;
  };
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId?: string;
  updatedAt: string;
  order?: 'asc' | 'desc';
}

export interface ImmichSharedLink {
  id: string;
  key: string;
  type: string;
  assets: ImmichAsset[];
}

export class ImmichApi {
  plugin: ImmichPicker

  constructor (plugin: ImmichPicker) {
    this.plugin = plugin
  }

  private get serverUrl (): string {
    return this.plugin.settings.serverUrl
  }

  private get apiKey (): string {
    return this.plugin.cachedApiKey || this.plugin.settings.apiKey
  }

  private getHeaders (): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json'
    }
  }

  async testConnection (): Promise<boolean> {
    if (!this.serverUrl || !this.apiKey) {
      return false
    }

    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/server/ping`,
        method: 'GET',
        headers: this.getHeaders()
      })
      return response.status === 200
    } catch (e) {
      console.error('Immich connection test failed:', e)
      return false
    }
  }

  private async search (endpoint: string, body: Record<string, unknown>, errorLabel: string): Promise<ImmichAsset[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}${endpoint}`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body)
    })

    if (response.status !== 200) {
      throw new Error(`${errorLabel}: ${response.status}`)
    }

    const data = response.json as ImmichSearchResponse
    return data.assets?.items || []
  }

  /**
   * Immich searches filter on a single visibility value, so timeline plus
   * archived takes two requests. The value is always sent explicitly because
   * the server default changed between versions: 1.133+ returns `timeline`
   * only, while 3.x returns everything that is not locked.
   *
   * `order` re-sorts the merged pages. Smart search has no such key, so its
   * archived hits are appended and each half keeps its relevance order.
   */
  private async searchVisible (
    endpoint: string,
    body: Record<string, unknown>,
    errorLabel: string,
    order?: 'asc' | 'desc'
  ): Promise<ImmichAsset[]> {
    if (!this.plugin.settings.includeArchived) {
      return this.search(endpoint, { ...body, visibility: 'timeline' }, errorLabel)
    }

    // Every asset has exactly one visibility, so the two pages never overlap.
    const [timeline, archived] = await Promise.all([
      this.search(endpoint, { ...body, visibility: 'timeline' }, errorLabel),
      this.search(endpoint, { ...body, visibility: 'archive' }, errorLabel)
    ])

    const merged = [...timeline, ...archived]
    if (order) {
      merged.sort((a, b) => {
        const diff = new Date(a.fileCreatedAt).getTime() - new Date(b.fileCreatedAt).getTime()
        return order === 'asc' ? diff : -diff
      })
    }
    return merged
  }

  async getRecentPhotos (count: number, page = 1): Promise<ImmichAsset[]> {
    return this.searchVisible(
      '/api/search/metadata',
      {
        page,
        size: count,
        type: 'IMAGE',
        order: 'desc'
      },
      'Failed to fetch photos',
      'desc'
    )
  }

  async searchPhotos (query: string, count: number, page = 1): Promise<ImmichAsset[]> {
    return this.searchVisible(
      '/api/search/smart',
      {
        query,
        page,
        size: count
      },
      'Failed to search photos'
    )
  }

  async searchOcr (query: string, count: number, page = 1): Promise<ImmichAsset[]> {
    // Immich's metadata search matches text found in the image by OCR.
    return this.searchVisible(
      '/api/search/metadata',
      { page, size: count, ocr: query, type: 'IMAGE', order: 'desc' },
      'Failed to search photos',
      'desc'
    )
  }

  async getPhotosByDate (date: moment.Moment, count: number, page = 1): Promise<ImmichAsset[]> {
    // Get photos taken on the specified date (from start to end of day)
    const takenAfter = date.clone().startOf('day').toISOString()
    const takenBefore = date.clone().endOf('day').toISOString()

    return this.searchVisible(
      '/api/search/metadata',
      {
        page,
        size: count,
        type: 'IMAGE',
        takenAfter,
        takenBefore,
        order: 'asc'
      },
      'Failed to fetch photos by date',
      'asc'
    )
  }

  getThumbnailUrl (assetId: string): string {
    // #.jpg fragment hints to Obsidian's parser that this is an image (doesn't affect HTTP request)
    return `${this.serverUrl}/api/assets/${assetId}/thumbnail?size=preview#.jpg`
  }

  getAssetUrl (assetId: string): string {
    return `${this.serverUrl}/photos/${assetId}`
  }

  async downloadThumbnail (assetId: string): Promise<ArrayBuffer> {
    const response = await requestUrl({
      url: this.getThumbnailUrl(assetId),
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey
      }
    })

    if (response.status !== 200) {
      throw new Error(`Failed to download thumbnail: ${response.status}`)
    }

    return response.arrayBuffer
  }

  async getAssetDetails (assetId: string): Promise<ImmichAssetDetails> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/assets/${assetId}`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to get asset details: ${response.status}`)
    }

    return response.json as ImmichAssetDetails
  }

  async getAlbums (): Promise<ImmichAlbum[]> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/albums`,
      method: 'GET',
      headers: this.getHeaders()
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch albums: ${response.status}`)
    }

    return response.json as ImmichAlbum[]
  }

  async getAlbumAssets (albumId: string, order: 'asc' | 'desc' = 'desc'): Promise<ImmichAsset[]> {
    // Immich 3.x no longer inlines `assets` in GET /api/albums/{id}, so the
    // album's contents have to be searched for by album id instead.
    const assets: ImmichAsset[] = []
    const pageSize = 1000

    for (let page = 1; page <= 100; page++) {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/search/metadata`,
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          albumIds: [albumId],
          page,
          size: pageSize,
          order
        })
      })

      if (response.status !== 200) {
        throw new Error(`Failed to fetch album assets: ${response.status}`)
      }

      const data = response.json as ImmichSearchResponse
      assets.push(...(data.assets?.items || []))

      if (!data.assets?.nextPage) break
    }

    // The search results also contain entries the album view folds away: the
    // companion video of a live photo, and assets hidden from the timeline.
    const livePhotoVideoIds = new Set(
      assets.map(a => a.livePhotoVideoId).filter((id): id is string => !!id)
    )

    return assets.filter(
      a => a.visibility !== 'hidden' && !livePhotoVideoIds.has(a.id)
    )
  }

  async createSharedLink (assetId: string): Promise<ImmichSharedLink> {
    const response = await requestUrl({
      url: `${this.serverUrl}/api/shared-links`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        type: 'INDIVIDUAL',
        assetIds: [assetId]
      })
    })

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Failed to create shared link: ${response.status}`)
    }

    return response.json as ImmichSharedLink
  }

  getSharedThumbnailUrl (assetId: string, shareKey: string): string {
    // Same #.jpg hint as getThumbnailUrl, so Obsidian's parser treats a shared
    // URL as an image too.
    return `${this.serverUrl}/api/assets/${assetId}/thumbnail?size=preview&key=${shareKey}#.jpg`
  }

  extractAssetIdFromUrl (url: string): string | null {
    // Match pattern: {serverUrl}/photos/{uuid}
    const serverUrlPattern = this.serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`${serverUrlPattern}/photos/([a-f0-9-]+)`, 'i')
    const match = url.match(pattern)
    return match ? match[1] : null
  }
}
