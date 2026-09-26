English | [简体中文](README.md)

# QuickImageCleaner

Make the solid background of an image transparent in one click, trim the extra space around it, and export as PNG.

**Use it online (no install needed): https://noodles-lover.github.io/QuickImageCleaner/**

---

## What kind of images it works on

**Good for**: product shots, portraits on a white backdrop, scans, screenshots, icon assets — images with a **solid or near-solid background**.

**Not for**: photos with complex or gradient backgrounds, or where hair and translucent objects blend into the background. Those need AI-based cutout tools.

---

## Highlights

- **Free**: no sign-up, no image limit, no watermark
- **Open source**: the code is public, free to view and modify, with no privacy leaks
- **Fast**: everything runs in your own browser, no upload waiting. Previews are processed at reduced resolution, so sliders respond instantly
- **Offline**: all processing happens on your machine; images never leave your computer and no network is needed
- **Convenient**: batch processing, with independent parameters per image; batch results keep the original file names, with no redundant prefixes or suffixes

---

## Three steps

1. Open the page and **drop** an image onto it (or click to browse, or press `Ctrl + V` to paste)
2. Confirm the background color — it is detected automatically when an image opens; if it is wrong, click **Pick** and then click the background in the image
3. Click **Export PNG (cropped)** or **Export PNG (full size)**

To compare results, toggle **Original**; to inspect edges, zoom with the mouse wheel.

---

## Batch processing

1. Click **Choose folder** and select the folder with your images
2. The page enters batch mode; use the arrows or the `←` `→` keys to preview images one by one
3. Each image has **its own parameters** (identical by default), while the background color is **auto-detected per image**
4. You can also skip per-image tuning — just click **Start**, and everything runs with the default parameters

Two save modes:

| Mode | Original | Result |
| --- | --- | --- |
| **Keep original** | saved as `name-original.jpg` | uses the original file name `name.png` |
| **Overwrite** | not kept | uses the original file name `name.png` |

> **Overwriting cannot be undone**: originals are rewritten (PNG) or deleted (non-PNG), and the tool cannot restore them. A confirmation dialog appears first — back up important images.

Notes:

- Only the **top level** of the folder is processed; subfolders are not entered and non-image files are skipped
- Export always re-runs at the **original resolution**, regardless of preview quality
- Writing to folders relies on the browser's File System Access API, so use **Chrome or Edge**

---

## Formats and limits

- **Input**: PNG / JPG / JPEG / JFIF / WebP / BMP / GIF / AVIF
- **Output**: PNG (with alpha)
- Per image: 40 megapixels and 16384 px per side at most
- GIF: only the first frame is used; the exported PNG is not animated

---

## Privacy

All image processing happens inside your browser — **nothing is uploaded to any server** and no network is required. The page loads a Baidu Analytics script to understand traffic; it never touches your image files.

You can also use the offline version: download the code and double-click `index.html` (writing to folders needs Chrome or Edge).

---

## Get involved

If this project helped you, **starring the repository** is the most direct way to support its maintenance.

**Forks** and **Pull Requests** are welcome too.

For issues, please attach the image in question and your browser info.

---

## License

Released under the [MIT License](LICENSE) — free to use, modify and distribute, including commercially, as long as the copyright notice is kept.
