import cv2
import numpy as np
from PIL import Image, ImageEnhance
from pathlib import Path
import os

class VisionMaxService:
    def enhance_image(self, image_path: str, brightness: float = 1.0, contrast: float = 1.0, sharpness: float = 1.0) -> str:
        """
        Enhances an image using Pillow and returns the path to the enhanced version.
        """
        # Load image
        img = Image.open(image_path)
        
        # Apply enhancements
        if brightness != 1.0:
            img = ImageEnhance.Brightness(img).enhance(brightness)
        if contrast != 1.0:
            img = ImageEnhance.Contrast(img).enhance(contrast)
        if sharpness != 1.0:
            img = ImageEnhance.Sharpness(img).enhance(sharpness)
            
        # Determine enhanced path
        # images/original/uuid_name.jpg -> images/enhanced/uuid_name.jpg
        enhanced_path = image_path.replace("/original/", "/enhanced/")
        Path(enhanced_path).parent.mkdir(parents=True, exist_ok=True)
        
        img.save(enhanced_path, quality=95)
        return enhanced_path

    def auto_enhance(self, image_path: str) -> str:
        """
        Performs automatic color correction and contrast enhancement using OpenCV.
        """
        # Load image with OpenCV
        img = cv2.imread(image_path)
        
        # Convert to LAB color space
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        # Apply CLAHE to L channel
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        cl = clahe.apply(l)
        
        # Merge channels
        limg = cv2.merge((cl,a,b))
        
        # Convert back to BGR
        enhanced_img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        
        enhanced_path = image_path.replace("/original/", "/enhanced/")
        Path(enhanced_path).parent.mkdir(parents=True, exist_ok=True)
        
        cv2.imwrite(enhanced_path, enhanced_img)
        return enhanced_path
