import { createClient } from '@supabase/supabase-js';

// Pega as chaves do ambiente
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

// Cria e exporta o cliente para que qualquer outro arquivo possa importá-lo
export const supabase = createClient(supabaseUrl, supabaseKey);