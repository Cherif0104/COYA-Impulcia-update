-- Performance : listes Documents (Knowledge Base) et Formations (courses + modules + leçons)
-- À appliquer manuellement via Supabase SQL Editor ou CLI selon votre processus.

-- Documents : tri récent + filtres organisation / créateur fréquents en liste
CREATE INDEX IF NOT EXISTS idx_documents_created_at_desc ON public.documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON public.documents (organization_id)
  WHERE organization_id IS NOT NULL;

-- Favoris documents : lookup par utilisateur (profiles.id)
CREATE INDEX IF NOT EXISTS idx_document_favorites_user_id ON public.document_favorites (user_id);

-- Cours : liste triée par date de création
CREATE INDEX IF NOT EXISTS idx_courses_created_at_desc ON public.courses (created_at DESC);

-- Modules de cours : chargement batch par plusieurs course_id (évite N requêtes séquentielles)
CREATE INDEX IF NOT EXISTS idx_course_modules_course_id_order ON public.course_modules (course_id, order_index);

-- Leçons : jointure module_id + ordre
CREATE INDEX IF NOT EXISTS idx_course_lessons_module_id_order ON public.course_lessons (module_id, order_index);
