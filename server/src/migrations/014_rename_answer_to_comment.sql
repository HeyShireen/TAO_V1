-- Migration 014: Renommer la colonne 'answer' en 'comment' dans generated_questions
-- Cette colonne stocke les commentaires ajoutés par les responsables sur les fiches questions

-- Renommer la colonne
ALTER TABLE generated_questions 
RENAME COLUMN answer TO comment;

-- Note: Cette migration est idempotente via l'ajout conditionnel dans le système de migrations
