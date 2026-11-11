-- Script DDL Oficial para PostgreSQL 16 y pgvector
-- Generado con base en el Diagrama Entidad-Relación Institucional UTS

-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Tabla de Roles (RBAC)
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion TEXT
);

INSERT INTO roles (nombre, descripcion) VALUES
('ADMINISTRADOR', 'Control total administrativo y creación de cuentas'),
('SUBADMINISTRADOR', 'Gestión de registros e índice documental')
ON CONFLICT (nombre) DO NOTHING;

-- 3. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rol_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    nombre_completo VARCHAR(150) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    estado_activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla de Carpetas (Jerarquía reflexiva)
CREATE TABLE IF NOT EXISTS carpetas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    carpeta_padre_id UUID REFERENCES carpetas(id) ON DELETE CASCADE,
    dropbox_id VARCHAR(150) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    ruta_completa TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_carpetas_padre ON carpetas(carpeta_padre_id);

-- 5. Tabla de Documentos
CREATE TABLE IF NOT EXISTS documentos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    carpeta_id UUID NOT NULL REFERENCES carpetas(id) ON DELETE RESTRICT,
    codigo_documental VARCHAR(100),
    dropbox_file_id VARCHAR(150) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    formato VARCHAR(15) NOT NULL,
    tipo VARCHAR(100),
    anio INT,
    ruta_completa TEXT NOT NULL,
    hash_contenido VARCHAR(64) NOT NULL,
    fecha_modificacion_dropbox TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documentos_busqueda ON documentos(nombre, codigo_documental, anio);
CREATE INDEX IF NOT EXISTS idx_documentos_filtros ON documentos(tipo, formato, anio);

-- 6. Tabla de Documento Lectura (Extracción y Hash)
CREATE TABLE IF NOT EXISTS documento_lectura (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    estado_extraccion VARCHAR(30) NOT NULL, -- RECONOCIDO | DESCONOCIDO | REINDEXAR
    hash_contenido VARCHAR(64) NOT NULL, -- SHA-256
    fecha_cambio TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lectura_doc ON documento_lectura(documento_id);

-- 7. Tabla de Vectores de Embeddings (pgvector)
CREATE TABLE IF NOT EXISTS documento_vector (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    numero_chunk INT NOT NULL,
    fragmento_texto TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índice HNSW para acelerar búsqueda por distancia coseno
CREATE INDEX IF NOT EXISTS idx_vectores_hnsw ON documento_vector 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 8. Tabla Unificada de Auditoría de Usuario (LOGS_USER)
CREATE TABLE IF NOT EXISTS logs_user (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES usuarios(id) ON DELETE SET NULL, -- Nullable para consultas públicas anónimas
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL, -- Nullable si no involucró descarga
    accion VARCHAR(50) NOT NULL, -- BUSQUEDA | DESCARGA | CRUD_DOC | LOGIN
    entidad VARCHAR(50) NOT NULL, -- DOCUMENTOS | SESION | METADATOS
    contenido_anterior JSONB,
    contenido_nuevo JSONB,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_user_fecha ON logs_user(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_logs_user_accion ON logs_user(accion, entidad);

-- 9. Trazabilidad de Sincronización Cron con Dropbox (LOGS_SINCRONIZACION_CRON_J)
CREATE TABLE IF NOT EXISTS logs_sincronizacion_cron_j (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha_inicio TIMESTAMP WITH TIME ZONE NOT NULL,
    fecha_fin TIMESTAMP WITH TIME ZONE,
    estado VARCHAR(30) NOT NULL, -- EXITOSO | FALLIDO | PARCIAL
    total_detectados INT DEFAULT 0,
    total_procesados INT DEFAULT 0,
    total_fallidos INT DEFAULT 0
);

-- 10. Detalles de Sincronización Cron (DETALLES_SINCRONIZACION_CRON_J)
CREATE TABLE IF NOT EXISTS detalles_sincronizacion_cron_j (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_sincronizacion_id UUID NOT NULL REFERENCES logs_sincronizacion_cron_j(id) ON DELETE CASCADE,
    archivo_ruta TEXT NOT NULL,
    operacion VARCHAR(30) NOT NULL, -- ALTA | MODIFICACION | ELIMINACION
    mensaje_error TEXT
);

