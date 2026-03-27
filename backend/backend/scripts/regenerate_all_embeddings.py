#!/usr/bin/env python3
"""
Regenerate all OEM schedule embeddings
Handles NULL embeddings across all records
Compatible with Supabase pgvector
"""

import os
import sys
import logging
from datetime import datetime
from sqlalchemy import create_engine, text
from sentence_transformers import SentenceTransformer
import psycopg2
from tqdm import tqdm

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL')
MODEL_NAME = 'all-MiniLM-L6-v2'  # 384-dimensional embeddings
BATCH_SIZE = 32
TIMEOUT = 600  # seconds

class EmbeddingGenerator:
    def __init__(self, db_url, model_name=MODEL_NAME):
        """Initialize embedding generator"""
        self.db_url = db_url
        self.model_name = model_name
        self.model = None
        self.engine = None
        self.stats = {
            'total_records': 0,
            'null_embeddings': 0,
            'generated': 0,
            'failed': 0,
            'existing': 0
        }
    
    def load_model(self):
        """Load sentence transformer model"""
        try:
            logger.info(f"📦 Loading embedding model: {self.model_name}")
            self.model = SentenceTransformer(self.model_name)
            logger.info("✅ Model loaded successfully")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            return False
    
    def connect_database(self):
        """Connect to Supabase database"""
        try:
            logger.info("🔗 Connecting to Supabase database...")
            self.engine = create_engine(self.db_url)
            with self.engine.connect() as conn:
                result = conn.execute(text("SELECT 1"))
                logger.info("✅ Database connection successful")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to connect to database: {e}")
            return False
    
    def get_null_embeddings(self):
        """Fetch all records with NULL embeddings"""
        try:
            logger.info("🔍 Finding records with NULL embeddings...")
            
            with self.engine.connect() as conn:
                query = text("""
                    SELECT id, service_type, notes, citation
                    FROM oem_schedules
                    WHERE content_embedding IS NULL
                    ORDER BY make, model, id
                """)
                
                result = conn.execute(query)
                records = result.fetchall()
            
            self.stats['null_embeddings'] = len(records)
            logger.info(f"📊 Found {len(records)} records with NULL embeddings")
            
            return records
        
        except Exception as e:
            logger.error(f"❌ Error fetching NULL embeddings: {e}")
            return []
    
    def get_total_oem_records(self):
        """Count total OEM schedule records"""
        try:
            with self.engine.connect() as conn:
                query = text("SELECT COUNT(*) FROM oem_schedules")
                result = conn.execute(query)
                count = result.scalar()
            
            self.stats['total_records'] = count
            logger.info(f"📊 Total OEM schedule records: {count}")
            return count
        
        except Exception as e:
            logger.error(f"❌ Error counting records: {e}")
            return 0
    
    def prepare_texts(self, records):
        """Prepare text for embedding from records"""
        texts = []
        record_ids = []
        
        for record in records:
            id_, service_type, notes, citation = record
            # Combine all text fields for embedding
            text = f"{service_type} {notes or ''} {citation or ''}"
            # Clean up whitespace
            text = ' '.join(text.split())
            texts.append(text)
            record_ids.append(id_)
        
        return texts, record_ids
    
    def generate_embeddings(self, texts):
        """Generate embeddings for texts"""
        try:
            logger.info(f"🧠 Generating embeddings for {len(texts)} records...")
            
            embeddings = self.model.encode(
                texts,
                show_progress_bar=True,
                batch_size=BATCH_SIZE,
                convert_to_list=True
            )
            
            logger.info(f"✅ Generated {len(embeddings)} embeddings")
            return embeddings
        
        except Exception as e:
            logger.error(f"❌ Error generating embeddings: {e}")
            return None
    
    def store_embeddings(self, record_ids, embeddings):
        """Store embeddings back to database"""
        try:
            logger.info("💾 Storing embeddings to database...")
            
            conn = psycopg2.connect(self.db_url)
            cursor = conn.cursor()
            
            update_count = 0
            
            for i, (record_id, embedding) in enumerate(
                tqdm(zip(record_ids, embeddings), total=len(record_ids))
            ):
                try:
                    embedding_list = embedding
                    
                    # Update record with vector
                    cursor.execute("""
                        UPDATE oem_schedules
                        SET content_embedding = %s::vector
                        WHERE id = %s
                    """, (str(embedding_list), record_id))
                    
                    update_count += 1
                
                except Exception as e:
                    self.stats['failed'] += 1
                    logger.debug(f"Failed to update record {record_id}: {e}")
            
            conn.commit()
            cursor.close()
            conn.close()
            
            self.stats['generated'] = update_count
            logger.info(f"✅ Successfully stored {update_count} embeddings")
            
            return True
        
        except Exception as e:
            logger.error(f"❌ Error storing embeddings: {e}")
            return False
    
    def verify_embeddings(self):
        """Verify embeddings were stored correctly"""
        try:
            logger.info("🔍 Verifying embeddings...")
            
            with self.engine.connect() as conn:
                # Count embeddings
                query = text("""
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN content_embedding IS NOT NULL THEN 1 END) as embedded,
                        COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_count
                    FROM oem_schedules
                """)
                
                result = conn.execute(query)
                row = result.fetchone()
                
                total, embedded, null_count = row
                
                logger.info(f"📊 Total records: {total}")
                logger.info(f"✅ Embedded records: {embedded}")
                logger.info(f"⚠️  NULL embeddings: {null_count}")
                
                # Check dimension
                query = text("""
                    SELECT ARRAY_LENGTH(content_embedding, 1) as dimensions
                    FROM oem_schedules
                    WHERE content_embedding IS NOT NULL
                    LIMIT 1
                """)
                
                result = conn.execute(query)
                row = result.fetchone()
                
                if row and row[0]:
                    dimensions = row[0]
                    logger.info(f"📐 Embedding dimensions: {dimensions}")
                
                return null_count == 0
        
        except Exception as e:
            logger.error(f"❌ Error verifying embeddings: {e}")
            return False
    
    def print_summary(self):
        """Print execution summary"""
        logger.info("\n" + "="*70)
        logger.info("EMBEDDING REGENERATION SUMMARY")
        logger.info("="*70)
        logger.info(f"Total OEM records: {self.stats['total_records']}")
        logger.info(f"NULL embeddings found: {self.stats['null_embeddings']}")
        logger.info(f"Embeddings generated: {self.stats['generated']}")
        logger.info(f"Failed: {self.stats['failed']}")
        logger.info(f"Existing (skipped): {self.stats['existing']}")
        logger.info("="*70 + "\n")
    
    def run(self):
        """Main execution method"""
        logger.info("🚀 Starting embedding regeneration process...\n")
        
        start_time = datetime.now()
        
        # Step 1: Load model
        if not self.load_model():
            return False
        
        # Step 2: Connect database
        if not self.connect_database():
            return False
        
        # Step 3: Get counts
        self.get_total_oem_records()
        
        # Step 4: Get NULL embeddings
        records = self.get_null_embeddings()
        
        if not records:
            logger.info("✅ No records with NULL embeddings found!")
            return True
        
        # Step 5: Prepare texts
        texts, record_ids = self.prepare_texts(records)
        
        # Step 6: Generate embeddings
        embeddings = self.generate_embeddings(texts)
        if embeddings is None:
            return False
        
        # Step 7: Store embeddings
        if not self.store_embeddings(record_ids, embeddings):
            return False
        
        # Step 8: Verify
        verification_passed = self.verify_embeddings()
        
        # Print summary
        self.print_summary()
        
        # Print timing
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        logger.info(f"⏱️  Total time: {duration:.2f} seconds")
        
        if verification_passed:
            logger.info("✅ COMPLETE: All embeddings regenerated successfully!")
            return True
        else:
            logger.warning("⚠️  Verification found some issues")
            return False


def main():
    """Main entry point"""
    
    if not DATABASE_URL:
        logger.error("❌ DATABASE_URL environment variable not set")
        return False
    
    generator = EmbeddingGenerator(DATABASE_URL)
    success = generator.run()
    
    return success


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
