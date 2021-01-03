let fs = require("fs");
let path = require("path");
let Schema = require("./schema");
let Utils = require("./utils");
let glob = require("glob");

class DataSource {

    #settings;
    #indexes;
    #data;
    #file;

    constructor(settings) {
        this.#settings = settings;
        this.#indexes = {};
        this.#data = new Map();

        if (settings.source) {
            if (settings.source.type) {
                let FileJs = require("./filejs/" + settings.source.type);
                this.#file = new FileJs();
            }
        }

        if (settings.uniques) {
            settings.uniques.forEach(keys => {
                if (!Utils.isArray(keys)) {
                    keys = [keys];
                }
                this.createIndex(keys, true);
            })
        }
    }

    static #getIndexName(keys) {
        return keys.join('_');
    }

    getData() {
        return this.#data;
    }

    createIndex(keys, unique) {
        let name = DataSource.#getIndexName(keys);
        if (!this.#indexes[name]) {
            this.#indexes[name] = {
                name: name,
                unique: unique,
                keys: keys,
                values: {
                }
            }
            let index = this.#indexes[name];
            this.#data.forEach((v, k) => {
                this.#values(v, index.keys, data => {
                    DataSource.#createIndexData(index, data, false);
                })
            })
        }
    }

    static #createIndexData(index, data, test) {
        let indexData = index.values[data];
        if (!indexData) {
            index.values[data] = {
                internal_refs: 0,
                external_refs: 0,
            }
            indexData = index.values[data];
        }
        if (index.unique && indexData.internal_refs === 1) {
            throw "the value not unique";
        }
        if (!test) {
            indexData.internal_refs++;
        }
    }

    static #removeIndexData(index, data, test) {
        let indexData = index.values[data];
        if (!indexData) {
            throw "can't find index data";
        }

        if (indexData.internal_refs === 0) {
            throw "can't remove index data"
        }

        if (indexData.internal_refs === 1 && indexData.external_refs !== 0) {
            throw "can not be removed because it is referenced";
        }

        if (!test) {
            indexData.internal_refs--;
            if (indexData.internal_refs === 0 && indexData.external_refs === 0) {
                index.values[data] = null;
            }
        }
    }

    #values(object, keys, action) {
        if (keys.length === 1) {
            let values = Utils.getValues(object, keys[0].split("."));
            values.forEach(value => {
                if (value) {
                    let data = JSON.stringify(value);
                    action(data);
                }
            });
        } else {
            let values = [];
            keys.forEach(key => {
                let vs = Utils.getValues(object, key.split("."))
                if (vs.length > 1) {
                    throw "can not supported, rs.length > 1";
                }
                if (vs[0]) {
                    values = values.concat(JSON.stringify(vs[0]));
                }
            })
            if (values.length !== 0) {
                let data = values.join("_");
                action(data);
            }
        }
    }

    #findIndexData(keys, value) {
        let name = DataSource.#getIndexName(keys);
        let index = this.#indexes[name];
        if (!index) {
            return null;
        }
        let indexData = index.values[value];
        if (!indexData) {
            return null;
        }
        if (indexData.internal_refs === 0) {
            return null;
        }
        return indexData;
    }


    #updateIndex(object, create) {
        let indexData = [];
        for (const id in this.#indexes) {
            let index = this.#indexes[id];
            this.#values(object, index.keys, data => {
                if (create) {
                    DataSource.#createIndexData(index, data, true);
                } else {
                    DataSource.#removeIndexData(index, data, true);
                }
                indexData.push({
                    index: index,
                    data: data,
                })
            });
        }

        let foreignIndexData = [];
        if (this.#settings.relations) {
            this.#settings.relations.forEach(item => {
                this.#values(object, item.keys, data => {
                    let indexData = item.reference.ds.#findIndexData(item.reference.keys, data);
                    if (!indexData) {
                        throw "can't find index data";
                    }
                    foreignIndexData.push(indexData);
                })
            })
        }

        foreignIndexData.forEach(indexData => {
            if (create) {
                indexData.external_refs++;
            } else {
                indexData.external_refs--;
            }
        })

        indexData.forEach(x => {
            if (create) {
                DataSource.#createIndexData(x.index, x.data, false);
            } else {
                DataSource.#removeIndexData(x.index, x.data, false);
            }
        })
    }

    get(id) {
        return this.#data.get(id);
    }

    create(object) {
        //console.log(object);
        let rs = this.#settings.schema.validate(object);
        if (rs.errors.length) {
            throw rs.errors;
        }
        this.#updateIndex(object, true);
        let id = Utils.generateId(object);
        this.#data.set(id, object);
    }

    remove(id) {
        let object = this.#data.get(id);
        if (object) {
            this.#updateIndex(object, false);
            this.#data.delete(id);
        }
    }

    update(id, object) {
        let old = this.#data.get(id);
        if (old) {
            this.remove(id);
            this.create(object);
        }
    }

    async load() {
        let settings = this.#settings;
        settings.data.forEach(data => {
            this.create(data);
        })
        if (this.#file) {
            //TODO
            this.#data = this.#file.load();

            /*
            let FileJs = require("./filejs/" + settings.source.type);
            let fileJs = new FileJs();
            let allFiles = [];
            for (const x of settings.source.files) {
                let files = glob.sync(x.name, {});
                for (let file of files) {
                    allFiles.push({
                        file: file,
                        sheet: x.sheet
                    })
                }
            }

             */

            //let allData = [];
            //for (const x of allFiles) {
            //    try {
            //        allData.push(await fileJs.load(x));
            //    } catch (ex) {
            //        console.log("can not open ", x);
            //    }
            //}


            //let allData = await Promise.all(allFiles.map(async x => {
            //    try {
            //        return await fileJs.load(x);
            //    } catch (ex) {
            //        console.log("can not open ", x);
            //    }
            //}));
            //console.log(allData);
        }
    }

    async save() {
        if (this.#file) {
            this.#file.save(this.#data);
        }
    }
}

module.exports = class {
    #schema
    #dds = {}
    constructor() {
        this.#schema = new Schema();
    }

    async load(filename) {
        let lstat = fs.lstatSync(filename)
        if (!lstat.isDirectory()) {
            return await this.#load(filename);
        } else {
            let files = fs.readdirSync(filename);
            for (const file of files) {
                await this.#load(filename + path.sep + file);
            }
        }
    }

    get(id) {
        return this.#dds[id];
    }

    #getId(filename) {
        return path.parse(path.basename(filename)).name;
    }

    async #load(filename) {
        if (!path.isAbsolute(filename)) {
            filename = process.cwd() + path.sep + filename;
        }
        filename = path.normalize(filename);
        let dirname = path.dirname(filename);
        let id = this.#getId(filename);
        if (!this.#dds[id]) {
            let settings = require(filename);
            this.#dds[id] = new DataSource(settings);
            settings.schema = this.#schema.load(dirname + path.sep + settings.schema);
            if (settings.relations) {
                for (const keys of settings.relations) {
                    if (!keys.reference.ds) {
                        keys.reference.ds = this.#dds[id];
                    } else {
                        let filename = dirname + path.sep + keys.reference.ds;
                        keys.reference.ds = await this.#load(filename);
                    }
                    if (!Utils.isArray(keys.reference.keys)) {
                        keys.reference.keys = [keys.reference.keys];
                    }
                    keys.reference.ds.createIndex(keys.reference.keys, false);
                }
            }
            await this.#dds[id].load();
        }
        return this.#dds[id];
    }
}




//async function main() {
//    let dds = new DDS;
//    let itemDs = await dds.load("ds/item.js");
//}


//main().then(x => {
//    console.log("done");
//})

//let cardPacksDs = dds.load("ds/set.js");
//console.log(cardPacksDs.getData());
//console.log(storeDs.getData());


//let storeDs = dds.load("ds/item.js");

//let cardPacksDs = dds.getDataSource("pack");

//cardPacksDs.create({id: "1", name: "2"});
//cardPacksDs.create({id: "2", name: "3"});
//cardPacksDs.create({id: "1", name: "1"});


//cardPacksDs.getData();
//let storeDs = dds.getDataSource("item");
//storeDs.create({id: "1", packId: "1"});

//console.log(storeDs.getData());


//cardPacksDs.remove("3bee076b0f474a0a8f5a8245d3d54cae")
//cardPacksDs.remove("4adc378e18d480400eb74ffd710969be")
