import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando carga de datos semilla (seed)...');

  // 1. Roles institucionales
  const rolAdmin = await prisma.role.upsert({
    where: { nombre: 'ADMINISTRADOR' },
    update: {},
    create: {
      nombre: 'ADMINISTRADOR',
      descripcion: 'Control total administrativo, gestión de usuarios e índice vectorial',
    },
  });

  const rolSubadmin = await prisma.role.upsert({
    where: { nombre: 'SUBADMINISTRADOR' },
    update: {},
    create: {
      nombre: 'SUBADMINISTRADOR',
      descripcion: 'Gestión de registros documentales y consulta de métricas',
    },
  });

  console.log('✅ Roles asegurados:', rolAdmin.nombre, rolSubadmin.nombre);

  // 2. Usuario Administrador inicial
  const adminEmail = 'admin@correo.uts.edu.co';
  const adminUser = await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      rolId: rolAdmin.id,
      nombreCompleto: 'Administrador General UTS',
      email: adminEmail,
      passwordHash: 'Admin123*', // En producción se hashea con Argon2id / bcrypt
      estadoActivo: true,
    },
  });

  console.log('✅ Usuario Administrador inicial:', adminUser.email);

  // 3. Carpeta raíz en Dropbox
  const carpetaRaiz = await prisma.carpeta.upsert({
    where: { dropboxId: 'id:uts_root_folder_000' },
    update: {},
    create: {
      dropboxId: 'id:uts_root_folder_000',
      nombre: 'UTS_DOCUMENTACION_OFICIAL',
      rutaCompleta: '/UTS_DOCUMENTACION_OFICIAL',
    },
  });

  console.log('✅ Carpeta raíz asegurada:', carpetaRaiz.nombre);

  console.log('✨ Seed completado exitosamente.');
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

