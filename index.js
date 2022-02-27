const { exec } = require("child_process");
const colors = require("colors");
const fs = require("fs");
const path = require("path");

function commandToPromise(commandStr) {
  return new Promise(function (resolve, reject) {
    exec(commandStr, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

const main = async () => {
  try {
    let outputString = await commandToPromise("adb devices");
    if (outputString.stderr) {
      console.error("Ocurrio un error al generar la lista de dispositivos");
      return;
    }
    let deviceList = generateDeviceList(outputString.stdout);
    for (let deviceID of deviceList) {
      await installAPKS(deviceID);
      await installBundles(deviceID);
    }
  } catch (error) {
    console.error(error);
  }
};

main();

function generateDeviceList(outputString) {
  let rawDeviceList = outputString.split("\r\n");
  rawDeviceList.splice(0, 1);
  let finalDeviceList = [];
  for (let rawDevice of rawDeviceList) {
    if (rawDevice != "") {
      let tempRaw = rawDevice.split("\t");
      finalDeviceList.push(tempRaw[0]);
    }
  }
  return finalDeviceList;
}

async function installAPKS(deviceID) {
  const apkPath = "./apks/";
  fs.readdirSync(apkPath).forEach(async (file) => {
    let filePath = apkPath + file;
    if (!file.endsWith(".apk")) {
      console.log(file + "no es un archivo instalable de Android".red);
      return;
    }
    console.log(
      "Instalando " + filePath.yellow + " en el dispositivo " + deviceID.magenta
    );
    try {
      await apkSingleInstaller(deviceID, filePath);
      console.log(
        filePath.yellow +
          " correctamente instalado en el dispositivo ".green +
          deviceID.magenta
      );
    } catch (error) {
      console.error(
        "Error: ".red,
        `\nOcurrió un error al intentar instalar el archivo ${filePath} en el dispositivo ${deviceID}`
      );
    }
  });
}

async function installBundles(deviceID) {
  const bundlePath = "./bundles/";
  fs.readdirSync(bundlePath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .forEach(async (file) => {
      let dirPath = bundlePath + file;
      console.log(
        "Instalando el conjunto " +
          dirPath.yellow +
          " en el dispositivo " +
          deviceID.magenta
      );

      try {
        await bundleInstaller(deviceID, dirPath, file);
      } catch (error) {
        console.error(
          "Error: ".red,
          `Ocurrio un error al instalar el bundle ${file} en el dispositivo ${deviceID}`
        );
        if (error.stderr) {
          console.error(error.stderr);
        } else {
          console.error(error);
        }
      }
    });
}

async function apkSingleInstaller(deviceID, filePath) {
  try {
    let result = await commandToPromise(
      `adb -s ${deviceID} install ${filePath}`
    );
    if (result.stderr) {
      console.log(`El proceso finalizó con errores ${result.stderr}`);
    }
  } catch (error) {
    console.error(
      `No se pudo instalar ${filePath} en el dispositivo ${deviceID}`.red,
      "Error: ",
      error
    );
  }
}

async function bundleInstaller(deviceID, bundleDirPath, bundleName) {
  let fileList = fs
    .readdirSync(bundleDirPath)
    .filter((file) => path.extname(file).toLowerCase() === ".apk");

  if (fileList.length > 0) {
    let TOTAL_APK_SIZE_IN_BYTES = 0;
    let TARGET_PATH = `/data/local/tmp/split-apk/${bundleName}`;
    //Crear directorio donde pushearemos los archivos
    try {
      let createTempDir = await commandToPromise(
        `adb -s ${deviceID} shell mkdir -p ${TARGET_PATH}`
      );
      if (createTempDir.stderr) {
        console.log(`El proceso finalizó con errores ${result.stderr}`);
      }

      for (let file of fileList) {
        let fullFilePath = bundleDirPath + "/" + file;
        //Pusheamos los archivos y acumulamos su tamaño
        try {
          let pushArchive = await commandToPromise(
            `adb -s ${deviceID} push ${fullFilePath} ${TARGET_PATH}`
          );
          if (pushArchive.stderr) {
            console.log(`El proceso finalizó con errores ${result.stderr}`);
          }
          TOTAL_APK_SIZE_IN_BYTES = +fs.statSync(fullFilePath).size;
        } catch (error) {
          console.error(
            "Error: ".red,
            `Ocurrio un error al crear el archivo ${file} en el dispositivo ${deviceID}`
          );
          if (error.stderr) {
            console.error(error.stderr);
          } else {
            console.error(error);
          }
        }
      }

      //Creamos la sesion de instalacion
      try {
        let installSession = await commandToPromise(
          `adb -s ${deviceID} shell pm install-create -S ${TOTAL_APK_SIZE_IN_BYTES}`
        );
        if (installSession.stderr) {
          console.log(`El proceso finalizó con errores ${result.stderr}`);
        }
        let installSessionID = installSession.stdout
          .split("[")
          .pop()
          .split("]")[0];
        console.log(
          "Sesion de instalacion creada exitosamente".green,
          installSessionID
        );

        for (let index = 0; index < fileList.length; index++) {
          let file = fileList[index];
          let fullFilePath = bundleDirPath + "/" + file;
          let APK_SIZE = fs.statSync(fullFilePath).size;
          console.log(
            "Instalando APK: ".blue,
            file,
            " Tamaño: ".green,
            APK_SIZE,
            " Indice: ".green,
            index
          );
          //Creamos el install-write para cada AP
          try {
            let targetFile = TARGET_PATH + "/" + file;
            let installWrite = await commandToPromise(
              `adb -s ${deviceID} shell pm install-write -S ${APK_SIZE} ${installSessionID} ${index} ${targetFile}`
            );
            if (installWrite.stderr) {
              console.log(`El proceso finalizó con errores ${result.stderr}`);
            }
            console.log(`Exitosamente instalado el conjunto ${bundleName} en el dispositivo ${deviceID}`.green);
          } catch (error) {
            console.error(
              "Error: ".red,
              `Ocurrio un error al crear el install-write para el archivo ${file} en el dispositivo ${deviceID}`
            );
            if (error.stderr) {
              console.error(error.stderr);
            } else {
              console.error(error);
            }
          }
        }

        //Commit de la install sesion
        try {
          let installCommit = await commandToPromise(
            `adb -s ${deviceID} shell pm install-commit ${installSessionID}`
          );
          if (installCommit.stderr) {
            console.log(`El proceso finalizó con errores ${result.stderr}`);
          }
        } catch (error) {
          console.error(
            "Error: ".red,
            `Ocurrio un error al cerrar la sesion de instalacion en el dispositivo ${deviceID}`
          );
          if (error.stderr) {
            console.error(error.stderr);
          } else {
            console.error(error);
          }
        }
      } catch (error) {
        console.error(
          "Error: ".red,
          `Ocurrio un error al crear la sesion de instalacion en el dispositivo ${deviceID}`
        );
        if (error.stderr) {
          console.error(error.stderr);
        } else {
          console.error(error);
        }
      }
    } catch (error) {
      console.error(
        "Error: ".red,
        `Ocurrio un error al crear el directorio ${TARGET_PATH} en el dispositivo ${deviceID}`
      );
      if (error.stderr) {
        console.error(error.stderr);
      } else {
        console.error(error);
      }
    }
  } else {
    console.log(
      `El conjunto ${bundleDirPath} no tiene archivos para instalar`.red
    );
  }
}
