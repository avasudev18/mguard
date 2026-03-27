import pytesseract
from pdf2image import convert_from_path
from PIL import Image
import os
import tempfile
from typing import Optional

class OCRService:
    """
    Text extraction service with two paths:

    Primary  — Claude Vision (send image directly, no OCR step)
    Fallback — Tesseract OCR (used if Vision fails or is unavailable)

    invoices.py calls extract_text_from_file() for the Tesseract path.
    The Vision path is driven directly from invoices.py via
    llm_service.extract_invoice_data_from_image(), so this service only
    needs to expose a PDF→image helper for that path.
    """

    # ── Tesseract path (unchanged, used as fallback) ──────────────────────────

    @staticmethod
    async def extract_text_from_file(file_path: str) -> Optional[str]:
        """
        Extract text via Tesseract OCR.
        Used as fallback when Claude Vision fails.
        """
        try:
            file_extension = os.path.splitext(file_path)[1].lower()
            if file_extension == '.pdf':
                return await OCRService._extract_from_pdf(file_path)
            elif file_extension in ['.jpg', '.jpeg', '.png', '.tiff', '.bmp']:
                return await OCRService._extract_from_image(file_path)
            else:
                raise ValueError(f"Unsupported file type: {file_extension}")
        except Exception as e:
            print(f"OCR extraction failed: {str(e)}")
            return None

    @staticmethod
    async def _extract_from_pdf(pdf_path: str) -> str:
        """Extract text from PDF by converting to images first (Tesseract path)."""
        try:
            images = convert_from_path(pdf_path, dpi=300)
            full_text = []
            for i, image in enumerate(images):
                print(f"Processing PDF page {i+1}/{len(images)}...")
                text = pytesseract.image_to_string(image)
                full_text.append(text)
            return "\n\n--- PAGE BREAK ---\n\n".join(full_text)
        except Exception as e:
            print(f"PDF OCR failed: {str(e)}")
            raise

    @staticmethod
    async def _extract_from_image(image_path: str) -> str:
        """Extract text from image file (Tesseract path)."""
        try:
            image = Image.open(image_path)
            text = pytesseract.image_to_string(image)
            return text
        except Exception as e:
            print(f"Image OCR failed: {str(e)}")
            raise

    # ── Vision path helper ────────────────────────────────────────────────────

    @staticmethod
    async def pdf_to_image_path(pdf_path: str) -> Optional[str]:
        """
        Convert ALL pages of a PDF to a single stitched PNG file.
        Pages are stacked vertically so Claude Vision sees the full document.

        Previously this only converted page 1, causing multi-page invoices
        (e.g. CDK Global dealer invoices) to have their service lines missed
        because Line A/B/C descriptions span the full first page while the
        summary cost table appears at the bottom — or across pages entirely.

        Returns the temp file path, or None on failure.
        The caller is responsible for deleting the temp file after use.
        """
        try:
            images = convert_from_path(pdf_path, dpi=200)
            if not images:
                return None

            if len(images) == 1:
                # Single page — save directly, no stitching needed
                tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                images[0].save(tmp.name, "PNG")
                tmp.close()
            else:
                # Multi-page — stitch vertically into one tall PNG
                total_width  = max(img.width  for img in images)
                total_height = sum(img.height for img in images)
                stitched = Image.new("RGB", (total_width, total_height), color=(255, 255, 255))
                y_offset = 0
                for img in images:
                    stitched.paste(img, (0, y_offset))
                    y_offset += img.height
                tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                stitched.save(tmp.name, "PNG")
                tmp.close()
                print(f"PDF stitched {len(images)} pages → {tmp.name}")

            print(f"PDF converted to image: {tmp.name}")
            return tmp.name
        except Exception as e:
            print(f"PDF→image conversion failed: {str(e)}")
            return None

    @staticmethod
    def preprocess_image(image: Image.Image) -> Image.Image:
        """Preprocess image for Tesseract (grayscale). Not used in Vision path."""
        return image.convert('L')


# Singleton instance
ocr_service = OCRService()
