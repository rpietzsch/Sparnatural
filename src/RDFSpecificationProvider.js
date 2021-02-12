
const factory = require('@rdfjs/data-model');
const rdfParser = require("rdf-parse").default;
const rdfDereferencer = require("rdf-dereference").default;
import {storeStream} from "rdf-store-stream";
const N3 = require('n3');
const Datasources = require("./SparnaturalConfigDatasources.js");

const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF = {
	TYPE : factory.namedNode(RDF_NAMESPACE+"type"),
	FIRST : factory.namedNode(RDF_NAMESPACE+"first"),
	REST : factory.namedNode(RDF_NAMESPACE+"rest"),
	NIL : factory.namedNode(RDF_NAMESPACE+"nil"),
};

const RDFS_NAMESPACE = "http://www.w3.org/2000/01/rdf-schema#";
const RDFS = {
	LABEL : factory.namedNode(RDFS_NAMESPACE+"label"),
	DOMAIN : factory.namedNode(RDFS_NAMESPACE+"domain"),
	RANGE : factory.namedNode(RDFS_NAMESPACE+"range"),
	SUBPROPERTY_OF : factory.namedNode(RDFS_NAMESPACE+"subPropertyOf"),
	SUBCLASS_OF : factory.namedNode(RDFS_NAMESPACE+"subClassOf")
};

const OWL_NAMESPACE = "http://www.w3.org/2002/07/owl#";
const OWL = {
	EQUIVALENT_PROPERTY : factory.namedNode(OWL_NAMESPACE+"equivalentProperty"),
	EQUIVALENT_CLASS : factory.namedNode(OWL_NAMESPACE+"equivalentClass"),
	UNION_OF : factory.namedNode(OWL_NAMESPACE+"unionOf")
};

var Config = require('./SparnaturalConfig.js');

export class RDFSpecificationProvider {

	constructor(n3store, lang) {
		console.log("RDFSpecificationProvider");

		// init memory store
		this.store = n3store;
		this.lang = lang;
	}

	static async build (specs, lang) {

		// init memory store
		var store = new N3.Store();

		// parse input specs
		console.log(specs);
		const textStream = require('streamify-string')(specs);
		const quadStream = rdfParser.parse(
			textStream,
		  	{ contentType: 'text/turtle' }
		);
		
		// import into store
		// note the await keyword to wait for the asynchronous call to finish
		var store = await storeStream(quadStream);
		console.log('Specification store populated with '+store.countQuads()+" triples.");
  		var provider = new RDFSpecificationProvider(store, lang);
        return provider;
    }

	getClassesInDomainOfAnyProperty() {
		const quadsArray = this.store.getQuads(
			undefined,
			RDFS.DOMAIN,
		  	// other arguments are left undefined
		);

		var items = [];
		for (const quad of quadsArray) {
			// we are not looking at domains of _any_ property
		    // the property we are looking at must be a Sparnatural property, with a known type
			var objectPropertyId = quad.subject.id;
		    var classId = quad.object.id;

		    if(this.getObjectPropertyType(objectPropertyId)) {

		    	// keep only Sparnatural classes in the list
		    	if(this.isSparnaturalClass(classId)) {
			    	// always exclude RemoteClasses from first list
			    	if(!this.isRemoteClass(classId)) {
			    		if(!this._isUnionClass(classId)) {			    
						    this._pushIfNotExist(classId, items);	
					    } else {
					    	// read union content
					    	var classesInUnion = this._readUnionContent(classId);
					    	for (const aUnionClass of classesInUnion) {
							    this._pushIfNotExist(aUnionClass, items);	
					    	}
					    }
			    	}
		   		}
			    
			}
		}
		console.log("Classes in domain of any property "+items);
		return items;
	}

	getLabel(entityId) {
		return this._readAsLiteralWithLang(entityId, RDFS.LABEL, this.lang)
	}

	getIcon(classId) {
		var faIcon = this._readAsLiteral(classId, factory.namedNode(Config.FA_ICON));
		if(faIcon != null) {
			// use of fa-fw for fixed-width icons
			return "<span style='font-size: 170%;' >&nbsp;<i class='" + faIcon + " fa-fw'></i></span>";
		} else {
			var icon = this._readAsLiteral(classId, factory.namedNode(Config.ICON));
			if ( icon != null) {
				return icon;
			} else {
				// this is ugly, just so it aligns with other entries having an icon
				return "<span style='font-size: 175%;' >&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>";
			}
		}
	}

	getHighlightedIcon(classId) {
		return this._readAsLiteral(classId, factory.namedNode(Config.HIGHLIGHTED_ICON));
	}

	getConnectedClasses(classId) {
		var items = [];

		const properties = this._readPropertiesWithDomain(classId);

		// now read their ranges
		for (const aProperty of properties) {

			var classesInRange = this._readClassesInRangeOfProperty(aProperty);

			for (const aClass of classesInRange) {
				// if it is not a Sparnatural Class, read all its subClasses that are Sparnatural classes
				if(!this.isSparnaturalClass(aClass)) {
					// TODO : recursivity
					var subClasses = this._readImmediateSubClasses(aClass);
					for (const aSubClass of subClasses) {
						if(this.isSparnaturalClass(aSubClass)) {
							this._pushIfNotExist(aSubClass, items);
						}
					}
				} else {
					this._pushIfNotExist(aClass, items);
				}

			}
		}

		return items ;
	}

	hasConnectedClasses(classId) {
		return ( this.getConnectedClasses(classId).length > 0 );
	}

	getConnectingProperties(domainClassId, rangeClassId) {
		var items = [];

		const properties = this._readPropertiesWithDomain(domainClassId);

		for (const aProperty of properties) {
		    
			var classesInRange = this._readClassesInRangeOfProperty(aProperty);

			if(classesInRange.indexOf(rangeClassId) > -1) {
				this._pushIfNotExist(aProperty, items);
			} else {
				// potentially the select rangeClassId is a subClass, let's look up
				for (const aClass of classesInRange) {
					// TODO : recursivity
					var subClasses = this._readImmediateSubClasses(aClass);
					if(subClasses.indexOf(rangeClassId) > -1) {
						this._pushIfNotExist(aProperty, items);
					}
				}
			}
		}

		return items ;
	}

	getObjectPropertyType(objectPropertyId) {
		var superProperties = this._readAsResource(objectPropertyId, RDFS.SUBPROPERTY_OF);

		var KNOWN_PROPERTY_TYPES = [
			Config.LIST_PROPERTY,
			Config.TIME_PROPERTY_PERIOD,
			Config.TIME_PROPERTY_YEAR,
			Config.TIME_PROPERTY_DATE,
			Config.AUTOCOMPLETE_PROPERTY,
			Config.SEARCH_PROPERTY,
			Config.GRAPHDB_SEARCH_PROPERTY,
			Config.NON_SELECTABLE_PROPERTY
		];

		// only return the type if it is a known type
		for (const aSuperProperty of superProperties) {
			if(KNOWN_PROPERTY_TYPES.includes(aSuperProperty)) {
				return aSuperProperty;
			}
		}
		
		return undefined;
	}


	isRemoteClass(classUri) {
		return this.store.getQuads(
			factory.namedNode(classUri),
			RDFS.SUBCLASS_OF,
			factory.namedNode(Config.NOT_INSTANTIATED_CLASS)
		).length > 0;
	}

	isLiteralClass(classUri) {
		return this.store.getQuads(
			factory.namedNode(classUri),
			RDFS.SUBCLASS_OF,
			factory.namedNode(Config.RDFS_LITERAL)
		).length > 0;
	}

	isSparnaturalClass(classUri) {
		return this.store.getQuads(
			factory.namedNode(classUri),
			RDFS.SUBCLASS_OF,
			factory.namedNode(Config.SPARNATURAL_CLASS)
		).length > 0;
	}


	expandSparql(sparql) {
		// for each owl:equivalentProperty ...
		var equivalentPropertiesPerProperty = {};
		this.store.getQuads(
			undefined,
			OWL.EQUIVALENT_PROPERTY,
			undefined
		).forEach( quad => {
			// store it if multiple equivalences are declared
			if(!equivalentPropertiesPerProperty[quad.subject.id]) {
				equivalentPropertiesPerProperty[quad.subject.id] = [];
			}
			equivalentPropertiesPerProperty[quad.subject.id].push(quad.object.id);			
		});
		// join the equivalences with a |
		for (let [property, equivalents] of Object.entries(equivalentPropertiesPerProperty)) {
			var re = new RegExp("<" + property + ">","g");
			sparql = sparql.replace(re, "<" + equivalents.join(">|<") + ">");
		}		

		// for each owl:equivalentClass ...
		var equivalentClassesPerClass = {};
		this.store.getQuads(
			undefined,
			OWL.EQUIVALENT_CLASS,
			undefined
		).forEach( quad => {
			// store it if multiple equivalences are declared
			if(!equivalentClassesPerClass[quad.subject.id]) {
				equivalentClassesPerClass[quad.subject.id] = [];
			}
			equivalentClassesPerClass[quad.subject.id].push(quad.object.id);			
		});
		// use a VALUES if needed
		var i = 0;
		for (let [aClass, equivalents] of Object.entries(equivalentClassesPerClass)) {
			var re = new RegExp("<" + aClass + ">","g");
			if(equivalents.length == 1) {
				sparql = sparql.replace(re, "<" + equivalents[0] + ">");
			} else {
				sparql = sparql.replace(re, "?class"+i+" . VALUES ?class"+i+" { <"+ equivalents.join("> <") +"> } ");
			}
			i++;
		}

		// for each equivalentPath
		var equivalentPathsPerEntity = {};
		this.store.getQuads(
			undefined,
			Config.SPARQL_STRING,
			undefined
		).forEach( quad => {
			var re = new RegExp("<" + quad.subject.id + ">","g");
			sparql = sparql.replace(re, quad.object.value );			
		});

		return sparql;
	}

	getDatasource(propertyOrClassId) {
		var datasource = {};

		// read predicate datasource
		const datasourceQuads = this.store.getQuads(
			factory.namedNode(propertyOrClassId),
			Datasources.DATASOURCE,
		  	undefined
		);

		if(datasourceQuads.length == 0) {
			return null;
		}

		for (const datasourceQuad of datasourceQuads) {
			const datasourceUri = datasourceQuad.object.id;
		    var knownDatasource = Datasources.DATASOURCES_CONFIG.get(datasourceUri);
		    if(knownDatasource != null) {
		    	return knownDatasource;
		    } else {
		    	// read datasource characteristics

		    	// Alternative 1 : read optional queryString
		    	var queryStrings = this._readAsLiteral(datasourceQuad.object.id, Datasources.QUERY_STRING);
		    	if(queryStrings.length > 0) {
		    		datasource.queryString = queryStrings[0];	
		    	}		    	

		    	// Alternative 2 : query template + label path
		    	var queryTemplates = this._readAsResource(datasourceQuad.object.id, Datasources.QUERY_TEMPLATE);
		    	if(queryTemplates.length > 0) {
		    		var theQueryTemplate = queryTemplates[0];
		    		var knownQueryTemplate = Datasources.QUERY_STRINGS_BY_QUERY_TEMPLATE.get(theQueryTemplate);
		    		if(knownQueryTemplate != null) {
						// 2.1 It is known in default Sparnatural ontology
						datasource.queryTemplate = knownQueryTemplate;
					} else {
						// 2.2 Unknown, read the query string
						var queryStrings = this._readAsResource(theQueryTemplate, Datasources.QUERY_STRING);
						if(queryStrings.length > 0) {
							var queryString = queryStrings[0];
							datasource.queryTemplate = 
							(queryString.startsWith('"') && queryString.endsWith('"'))
								?queryString.substring(1,queryString.length-1)
								:queryString
							;
						}
					}

					// labelPath
					var labelPaths = this._readAsLiteral(datasourceQuad.object.id, Datasources.LABEL_PATH);
			    	if(labelPaths.length > 0) {
			    		datasource.labelPath = labelPaths[0];	
			    	}	

					// labelProperty
					var labelProperties = this._readAsResource(datasourceQuad.object.id, Datasources.LABEL_PROPERTY);
			    	if(labelProperties.length > 0) {
			    		datasource.labelProperty = labelProperties[0];	
			    	}
		    	}

		    	// read optional sparqlEndpointUrl
		    	var sparqlEndpointUrls = this._readAsLiteral(datasourceQuad.object.id, Datasources.SPARQL_ENDPOINT_URL);
		    	if(sparqlEndpointUrls.length > 0) {
		    		datasource.sparqlEndpointUrl = sparqlEndpointUrls[0];	
		    	}	
		    }
		}

		console.log("Returning following datasource");
		console.log(datasource);

		return datasource;
	}

	_readPropertiesWithDomain(classId) {
		var properties = [];

		const propertyQuads = this.store.getQuads(
			undefined,
			RDFS.DOMAIN,
		  	factory.namedNode(classId),
		);

		for (const aQuad of propertyQuads) {
			// only select properties with proper Sparnatural configuration
			if(this.getObjectPropertyType(aQuad.subject.id)) {
		    	this._pushIfNotExist(aQuad.subject.id, properties);
			}
		}

		// read also the properties having as a domain a union containing this class
		var unionsContainingThisClass = this._readUnionsContaining(classId);
		
		for (const aUnionContainingThisClass of unionsContainingThisClass) {
		    const propertyQuadsHavingUnionAsDomain = this.store.getQuads(
				undefined,
				RDFS.DOMAIN,
			  	aUnionContainingThisClass,
			);

			for (const aQuad of propertyQuadsHavingUnionAsDomain) {
				// only select properties with proper Sparnatural configuration
				if(this.getObjectPropertyType(aQuad.subject.id)) {
				    this._pushIfNotExist(aQuad.subject.id, properties);
				}
			}
		}

		// read also the properties having as a domain a super-class of this class
		var superClassesOfThisClass = this._readImmediateSuperClasses(classId);

		for (const anImmediateSuperClass of superClassesOfThisClass) {
			var propertiesFromSuperClass = this._readPropertiesWithDomain(anImmediateSuperClass);
			for (const aProperty of propertiesFromSuperClass) {
			    this._pushIfNotExist(aProperty, properties);
			}
		}		

		return properties;
	}

	_readClassesInRangeOfProperty(propertyId) {
		var classes = [];

		const propertyQuads = this.store.getQuads(
			factory.namedNode(propertyId),
			RDFS.RANGE,
		  	undefined,
		);

		for (const aQuad of propertyQuads) {
			if(!this._isUnionClass(aQuad.object.id)) {	
		    	this._pushIfNotExist(aQuad.object.id, classes);
		    } else {
		    	// read union content
		    	var classesInUnion = this._readUnionContent(aQuad.object.id);
		    	for (const aUnionClass of classesInUnion) {
				    this._pushIfNotExist(aUnionClass, classes);	
		    	}
		    }
		}

		return classes;
	}

	_readImmediateSuperClasses(classId) {
		var classes = [];

		const subClassQuads = this.store.getQuads(
			factory.namedNode(classId),
			RDFS.SUBCLASS_OF,
		  	undefined,
		);

		for (const aQuad of subClassQuads) {
			this._pushIfNotExist(aQuad.object.id, classes);
		}

		return classes;
	}


	_readImmediateSubClasses(classId) {
		var classes = [];

		const subClassQuads = this.store.getQuads(
			undefined,
			RDFS.SUBCLASS_OF,
		  	factory.namedNode(classId),
		);

		for (const aQuad of subClassQuads) {
			this._pushIfNotExist(aQuad.subject.id, classes);
		}

		return classes;
	}

	/**
	 * Reads rdf:type(s) of an entity, and return them as an array
	 **/
	_readRdfTypes(uri) {
		return this._readAsResource(uri, RDF.TYPE);
	}

	/**
	 * Reads the given property on an entity, and return values as an array
	 **/
	_readAsResource(uri, property) {
		return this.store.getQuads(
			factory.namedNode(uri),
			property,
			undefined
		)
		.map(quad => quad.object.id);
	}

	_readAsLiteral(uri, property) {
		return this.store.getQuads(
			factory.namedNode(uri),
			property,
			undefined
		)
		.map(quad => quad.object.value);
	}

	_readAsLiteralWithLang(uri, property, lang) {
		return this.store.getQuads(
			factory.namedNode(uri),
			property,
			undefined
		)
		.filter(quad => (quad.object.language == lang))
		.map(quad => quad.object.value);
	}

	_readAsRdfNode(rdfNode, property) {
		return this.store.getQuads(
			rdfNode,
			property,
			undefined
		)
		.map(quad => quad.object);
	}

	_hasProperty(rdfNode, property) {
		return this.store.getQuads(
			rdfNode,
			property,
			undefined
		).length > 0;
	}




	/*** Handling of UNION classes ***/

	_isUnionClass(classUri) {
		return this._hasProperty(factory.namedNode(classUri), OWL.UNION_OF);
	}

	_isInUnion(classUri) {
		return this.store.getQuads(
			undefined,
			RDF.FIRST,
			classUri
		).length > 0;;
	}

	_readUnionContent(classUri) {
		var lists = this._readAsRdfNode(factory.namedNode(classUri), OWL.UNION_OF);
		if(lists.length > 0) {
			return this._readList_rec(lists[0]);
		}
	}

	_readList_rec(list) {
		var result = this.store.getQuads(
			list,
			RDF.FIRST
		)
		.map(quad => quad.object.id);

		var subLists = this._readAsRdfNode(list, RDF.REST);
		if(subLists.length > 0) {
			result = result.concat(this._readList_rec(subLists[0]));
		}

		return result;
	}

	_readRootList(listId) {
		var root = this._readSuperList(listId);
		if(root == null) {
			return listId;
		} else {
			return this._readRootList(root);
		}
	}

	_readSuperList(listId) {
		const propertyQuads = this.store.getQuads(
			undefined,
			RDF.REST,
		  	listId
		);

		if(propertyQuads.length > 0) {
			return propertyQuads[0].subject.id;
		} else {
			return null;
		}
	}

	_readUnionsContaining(classId) {
		var unions = [];

		var listsContainingThisClass = this.store.getQuads(
			undefined,
			RDF.FIRST,
			factory.namedNode(classId)
		).map(quad => quad.subject);

		for (const aListContainingThisClass of listsContainingThisClass) {
			var rootList = this._readRootList(aListContainingThisClass);

			// now read the union pointing to this list
			var unionPointingToThisList = this.store.getQuads(
				undefined,
				OWL.UNION_OF,
				rootList
			).map(quad => quad.subject);

			if(unionPointingToThisList.length > 0) {
				unions.push(unionPointingToThisList[0]);
			}
		}

		return unions;
	}

	/*** / Handling of UNION classes ***/

	_pushIfNotExist(item, items) {
		if (items.indexOf(item) < 0) {
			items.push(item) ;
		}

		return items ;			
	}

}