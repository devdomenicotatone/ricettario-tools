#!/usr/bin/env python3
"""
🔍 OCR Surya — Estrazione testo da immagini ricettario Philips
Usa Surya OCR per estrarre testo da immagini PNG e salvarlo in JSON.

Uso:
  py -3.13 ocr-surya.py --input "cartella1" "cartella2" "cartella3"
  py -3.13 ocr-surya.py --input "cartella1" --output "data/ocr-results.json"
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from langdetect import detect
from langdetect.lang_detect_exception import LangDetectException

# Fix encoding Windows (cp1252 non supporta emoji)
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def filter_italian(text):
    """Filtra righe non-italiane dal testo OCR usando langdetect."""
    lines = text.split('\n')
    kept = []
    removed = 0
    for line in lines:
        stripped = line.strip()
        # Righe corte (<15 char) o numeri/simboli: tieni (non classificabili)
        if len(stripped) < 15 or not re.search(r'[a-zA-ZàèéìòùÀÈÉÌÒÙ]{3,}', stripped):
            kept.append(line)
            continue
        try:
            lang = detect(stripped)
            if lang == 'it':
                kept.append(line)
            else:
                removed += 1
        except LangDetectException:
            kept.append(line)  # In dubbio, tieni
    return '\n'.join(kept), removed


def extract_text_from_images(folders, output_path):
    """Estrae testo da tutte le immagini PNG nelle cartelle specificate."""

    # Import Surya
    print("🔄 Caricamento modelli Surya OCR...")
    start_load = time.time()

    from PIL import Image
    from surya.recognition import RecognitionPredictor
    from surya.detection import DetectionPredictor
    from surya.foundation import FoundationPredictor

    foundation_predictor = FoundationPredictor()
    recognition_predictor = RecognitionPredictor(foundation_predictor)
    detection_predictor = DetectionPredictor()

    print(f"✅ Modelli caricati in {time.time() - start_load:.1f}s")

    # Raccogli tutte le immagini
    all_images = []
    for folder in folders:
        folder_path = Path(folder)
        if not folder_path.exists():
            print(f"⚠️ Cartella non trovata: {folder}")
            continue

        pngs = sorted(folder_path.glob("*.png"))
        for png in pngs:
            all_images.append({
                "path": str(png),
                "filename": png.name,
                "folder": folder_path.name
            })

    if not all_images:
        print("❌ Nessuna immagine PNG trovata.")
        sys.exit(1)

    print(f"\n📂 Trovate {len(all_images)} immagini da processare\n")

    # Processa le immagini
    results = {}
    total = len(all_images)

    for idx, img_info in enumerate(all_images):
        filename = img_info["filename"]
        img_path = img_info["path"]
        folder_name = img_info["folder"]

        print(f"  [{idx + 1}/{total}] 🖼️ {filename}...", end=" ", flush=True)
        start = time.time()

        try:
            image = Image.open(img_path)
            predictions = recognition_predictor(
                [image],
                det_predictor=detection_predictor
            )

            # Estrai testo dalle predizioni
            page_text_lines = []
            total_confidence = 0.0
            line_count = 0

            for page_pred in predictions:
                for line in page_pred.text_lines:
                    text = line.text.strip()
                    if text:
                        page_text_lines.append(text)
                        total_confidence += line.confidence
                        line_count += 1

            full_text = "\n".join(page_text_lines)
            avg_confidence = total_confidence / line_count if line_count > 0 else 0.0

            # Filtra righe non-italiane
            filtered_text, lines_removed = filter_italian(full_text)
            filtered_count = len([l for l in filtered_text.split('\n') if l.strip()])

            results[filename] = {
                "folder": folder_name,
                "text": filtered_text,
                "lines": filtered_count,
                "confidence": round(avg_confidence, 3)
            }

            elapsed = time.time() - start
            filt_info = f" (-{lines_removed} non-IT)" if lines_removed > 0 else ""
            print(f"✅ {filtered_count} righe ({elapsed:.1f}s, conf: {avg_confidence:.2f}){filt_info}")

        except Exception as e:
            print(f"❌ Errore: {e}")
            results[filename] = {
                "folder": folder_name,
                "text": "",
                "lines": 0,
                "confidence": 0,
                "error": str(e)
            }

    # Salva risultati
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n{'═' * 50}")
    print(f"📊 RIEPILOGO")
    print(f"{'═' * 50}")
    ok = sum(1 for r in results.values() if r.get("lines", 0) > 0)
    print(f"  ✅ {ok}/{total} immagini con testo estratto")
    print(f"  💾 Salvato in: {output_file}")
    print()


def main():
    parser = argparse.ArgumentParser(description="OCR Surya per ricettario Philips")
    parser.add_argument(
        "--input", "-i",
        nargs="+",
        required=True,
        help="Cartelle contenenti le immagini PNG"
    )
    parser.add_argument(
        "--output", "-o",
        default="data/ocr-results.json",
        help="File JSON di output (default: data/ocr-results.json)"
    )

    args = parser.parse_args()

    print("\n🔍 ═══════════════════════════════════════")
    print("   SURYA OCR — Ricettario Philips")
    print("═══════════════════════════════════════════\n")

    extract_text_from_images(args.input, args.output)


if __name__ == "__main__":
    main()
