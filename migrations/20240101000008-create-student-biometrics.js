'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('student_biometrics', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      student_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        unique     : true,
        references : { model: 'students', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'CASCADE',
      },
      face_embedding: {
        type      : Sequelize.JSON,
        allowNull : true,
        comment   : 'Float array from face recognition model (e.g. 128-dim FaceNet vector)',
      },
      fingerprint_1: {
        type      : Sequelize.BLOB,
        allowNull : true,
        comment   : 'Raw fingerprint template bytes — right index finger by convention',
      },
      fingerprint_2: {
        type      : Sequelize.BLOB,
        allowNull : true,
        comment   : 'Raw fingerprint template bytes — left index finger by convention',
      },
      enrolled_at: {
        type      : Sequelize.DATE,
        allowNull : true,
        comment   : 'When biometrics were first enrolled',
      },
      last_updated: {
        type      : Sequelize.DATE,
        allowNull : true,
        comment   : 'When biometrics were last re-enrolled or updated',
      },
      is_active: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : true,
        comment      : 'Set false to disable biometric login without deleting data',
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_biometrics');
  },
};
