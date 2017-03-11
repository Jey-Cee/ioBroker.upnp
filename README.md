![Logo](http://img.shields.io/npm/v/iobroker.upnp.svg) ![Image](https://travis-ci.org/Jey-Cee/ioBroker.upnp.svg?branch=master)

![Logo](admin/upnp-discovery.png)
# ioBroker.upnp
=================

IMPORTANT: This Adapter is BETA state.

***Node 4.x+ needed!***

German Description:

**Verwendungszweck**

Dient der Kommunikation und Interaktion mit allen upnp-Fähigen Geräten.

**Was ist upnp?**

upnp = Universal Plug and Play. Ist der versuch eine Standardisierung der Kommunikation zwischen Geräten im Netzwerk herzustellen.
Dazu gibt es sogenannte „Schemas“, diese werden in form einer xml Datei dargestellt. Sie enthalten alle Information über das Gerät oder die Software und deren Dienste die sie bereit stellen. Damit diese Dienste auch Nutzbar sind, wird auch eine Beschreibung zu jedem Dienst mitgeliefert. Diese Beschreibung folgt dem für den Dienst festgelegten Schema, dadurch können schnell Informationen und Befehle ausgetauscht werden ohne das es nötig ist zu wissen um welches Modell oder von welchem Hersteller das Gerät oder die Software ist.  In der Vergangenheit wurde diese Standardisierung vor allem für Mediengeräte und Software genutzt. Seit einiger Zeit gibt es Bestrebungen auch die Kommunikation des „IoT – Internet of Things“ mit dieser Standardisierung zu vereinheitlichen.
Dazu wurde 2016 die „Open connectivity Foundation“ gegründet, diese übernimmt die Aufgaben des upnp-Forums, welches die Zertifizierung von upnp-Fähigen Geräten durchgeführt und Standards erstellt hat.

**Funktionsbeschreibung**

Der Adapter führt beim ersten Start einen Broadcast durch und Wertet die Antworten aus. Die Antworten enthalten den Link zu den xml Dateien der Dienste. Anhand der xml Dateien werden die Objekte in ioBroker erzeugt und mit allen verfügbaren Informationen befüllt.

Zeitverzögert wird ein Dienst gestartet der auf Nachrichten von Geräten/Diensten wartet die sich an- oder abmelden. Neu erkannte Geräte/Dienste werden automatisch zu den vorhandenen hinzugefügt. Ein zweiter Dienst meldet sich bei jedem verfügbaren Gerät an und Abonniert Statusmeldungen, damit bekommt ioBroker jede Änderung (die gesendet wird) des Gerätes/Dienstes automatisch mitgeteilt.

**Objektstruktur**

Jedes Gerät oder Software die auf den Broadcast reagiert wird als eigenständiges Objekt angelegt. Unterhalb dieses Objekts befinden sich alle bereitgestellten Dienste mit ihren Möglichkeiten. Die Möglichkeiten werden in 3 Kategorien (Rolle/role) eingeteilt: indicator.state, action und argument.

**indicator.state –** ist eine Variable die den Aktuellen zustand eines Objekts/Datenpunkts im Gerät/Dienst darstellt. Jeder indicator.state hat einen bestimmten Type wie number, string, boolean,…. Darüber hinaus ist auch genau festgelegt welchen Wert oder Wertebereich der inidcator.state haben kann, diese Angaben sind im „native“ eines Objekts hinterlegt.
Bisher implementierte native’s:
-	sendEvents		= Bedeutung bis jetzt Unbekannt.
-	allowedValues		= Strings die Akzeptiert werden.
-	minimum		= Gibt den niedrigsten Zahlen wert an der Akzeptiert wird.
-	maximum		= Gibt den höchsten Zahlen wert an der Akzeptiert wird.
-	step			=  Gibt an in welchen Schritten ein Wert verändert werden kann.

**action –** ist ein Befehl der an das Gerät/den Dienst geschickt werden kann und von diesem Aktzeptiert wird. Dieses Objekt hat im Regelfall ein Unterobjekt, das argument.

**argument –** ist ein Unterobjekt von einer action. Der Type ist „gemischt“ da er nicht vorgegeben wird. In den native’s des Objekts finden sich verschiedene Informationen, sie können von argument zu argument anders sein.
Bisher bekannte native‘s:
-	direction 		=  	Gibt die Richtung an in der der Informationsfluss statt findet.
					„In“ bedeutet es wird kein Wert zurück geliefert.
					„Out“ bedeutet es wird ein Wert zurück geliefert.
-	relatedStateVariable	= 	Gibt den indicator.state an der für den Austausch der Daten
					Zuständig ist.
-	Argument_No		= 	Gibt an das wievielte Argument der Action es ist.

**Allgemeine Objekte**

Die folgenden Objekte finden sich für jedes Gerät/jeden Dienst und werden zur Verwaltung benötigt. Sie sind nicht Bestandteil des upnp Standards oder der Geräte-/Dienstbeschreibung des jeweiligen Gerätes.

**Alive –** wird vom Gerät/Dienst auf „true“ gesetzt und vom Adapter nach x Sekunden auf „null“ gesetzt, wenn das Gerät/Dienst diesen nicht wieder auf „true“ setzt. Die Ablauf zeit ist abhängig davon welche maximal Lebensdauer vom Gerät für das Alive signal mitgeteilt wurde. Wenn ein Gerät sich abmeldet wird der Status auf „false gesetzt. Es ist möglich dieses Objekt von Hand oder per Skript auf „true“ zu setzen, das sollte jedoch nur gemacht werden wenn man sicher ist dass das Gerät/Dienst erreichbar ist. Wenn Alive manuell auf „true“ gesetzt wurde sollte es auch manuell auf „false“ gesetzt werden wenn nicht mehr nötig, da andernfalls Fehler auftreten können.

**Sid –** Dient als identifikation der Subscription. Diese sid wird jedesmal vom host erzeugt wenn eine Subscription von einem client angefordert wird. Die sid läuft nach einer vom host definierten Zeit ab, daher wird sie immer wieder Aktualisiert. Sie gilt nur für einen bestimmten Dienst.

**Upnp Objekte**

Die hier auf gelisteten Objekte finden sich im upnp Standard und/oder den Geräte-/Dinestbeschreibungen. Es handelt sich hier nicht um eine Vollständige liste aller Objekte, diese Auswahl an Objekten stellt lediglich häufig vorkommende Objekte dar.

**(A_ARG_TYPE_)InstanceID –** Die InstanceID ist am Häufigsten zu finden und wird zwingend benötigt da sie die Instanz eines Dienstes angibt der angesprochen werden soll. In den meisten fällen ist die InstanceID = 0. Diese ID wird bei jeder Event message von einem Dienst und jedem Befehl der an einen Dienst gesendet wird, mit übergeben.

**(A_ARG_TYPE_)Channel(*) –** Das Channel Objekt findet sich im Zusammenhang mit Audio/Video Diensten. Ein Channel muss zum Beispiel angegeben werden wenn die Lautstärke verändert werden soll. Mögliche Werte können Beispielsweise „Master“, „LF“ oder „RF“ sein. In diesem Beispiel steht „Master“ für die Allgemeine Lautstärke, „LF“ für links vorne und „RF“ für rechts vorne. Wenn jetzt die Lautstärke nur rechts vorne verändert werden soll, gibt man „RF“ bei Channel an.

**(Set/Get)Volume(*) –** Das Volume Objekt findet sich im Zusammenhang mit Audio/Video Diensten. Je nachdem wo es vorkommt wird es zum Anzeigen der Lautstärke genutzt oder zum einstellen der Lautstärke. Dieses Objekt hat immer einen Mindestwert und einen Maximalwert den man angeben kann, in den meisten fällen liegt der Wertebereich zwischen 0 und 100. Die Schrittweite liegt normal bei 1, das bedeutet es können nur glatte Zahlen angegeben werden.

**Steuerung**

**Action –** Eine Action stellt einen Befehl dar, der an das Gerät/den Dienst geschickt werden kann. Zu jeder Action gehören auch Argumente, die Zwingend angegeben werden müssen. Action’s erkennt man an ihrer Rolle/role, dort steht „action“. Beschreibt man die Action mit „send“ wird der Befehl an das Gerät/den Dienst gesendet.

**Argument –** Muss zwingend bei einer Action angegeben werden, wenn unter „natives“ -> „direction“ „in“ steht. Mögliche Werte die angegeben werden können/müssen findet man in der „Related State Variable“. Der name dieser „Related State Variable“ ist im Objekt unter „native“ -> „relatedStateVariable“ hinterlegt.  Die Argumente müssen in einer bestimmten Reihenfolge angegeben werden, hierzu gibt es „native“ -> Argument_No. Ein Argument erkennt man an seiner Rolle/role, dort steht „argument“.  Manche strings müssen mit einem „““ in den Datenpunkt geschrieben werden. Es kann nicht pauschal beantwortet werden wann das der Fall ist, aber bei komplexen strings wie zum Beispiel URL’s kann das der Fall sein. Hier hilft nur ausprobieren. Will man ein " in einem Argument übergeben muss man "&quot;" verwenden.

**(Related State) Variable –** Es handelt sich um Variablen die für den Datenaustausch genutzt werden. In den Native‘s der Variablen finden sich verschiedene Informationen:
-	allowedValues: gibt Auskunft über die möglichen Inhalte der Variable oder was als Argument mit einer Action gesendet werden kann.
-	minimum: der niedrigste Wert den die Variable enthalten kann oder als Argument mit einer Action gesendet werden kann.
-	maximum: der höchste Wert den die Variable enthalten kann oder als Argument mit einer Action gesendet werden kann.
-	step: gibt an in welchen Schritten ein Wert angegeben wird.
-	sendEvents: ? Mögliche Werte sind „yes“ oder „no“. Es ist aber völlig unklar was das zu bedeuten hat. Die Annahme dass die Werte für diese Variable nur dann von einem Gerät/Dienst automatisch gesendet werden wenn „yes“ bei sendEvents steht hat sich nicht bestätigt.

##Geräte/Dienst Spezifische Besonderheiten

**Sonos:**
Für QPlay ist es nicht möglich eine Subscription zu erstellen. Möglicherweise ist hierfür eine Autentifikation notwendig

**Phillips Hue Bridge 2:**
Die implementierung des upnp Standards in der Hue Bridge 2 ist Fehlerhaft, weshalb die Hue Bridge 2 zwar gefunden wird jedoch nicht via upnp ansprechbar ist.

**Yamaha:**
Verwendet eine auf dem upnp Standard basierende API, die jedoch ein eigenes Datenformat verwendet. Derzeit wird das vom upnp Adapter nicht unterstützt.

**Sony:**
Verwendet eine ScalarWebApi genannte Schnittstelle die über upnp ansprechbar ist jedoch ein eigenes Daten Format verwendet. Derzeit wird das vom upnp Adapter nicht unterstützt.

**Amazon Kindle:**
Stellt einen upnp Dienst bereit, jedoch wird keine upnp-Dienstbeschreibung geliefert und kann daher nicht genutzt werden.




## Changelog

### 0.3.6
* (jey-cee) fixed problem with settings

### 0.3.5
* (jey-cee) added option in settings for disable auto discover

### 0.3.4
* (jey-cee) added Travis-CI Tests

### 0.3.3
* (jey-cee) try to fix bug that cause to crash the adapter when sending actions
* (jey-cee) added unsubscribe on subscription error
* (jey-cee) added sync between Arguments and the related State Variable
* (jey-cee) fixed bug when sending an action and there comes no answer

### 0.3.2
* (jey-cee) updated version number from 0.2.4 to 0.3.2

### 0.3.0
* (jey-cee) added native Argument_No for object type argument
* (jey-cee) changed state update handling for event messages, fix for A_ARG_TYPE states
* (jey-cee) added possibility for controling upnp devices

### 0.2.4
* (jey-cee) updated npm package node-upnp-subscriptions to resolve max handler problem
* (jey-cee) added support for 2nd stage deviceList
* (jey-cee) bugfix: iobroker stops while updating a lot of objects
* (jey-cee) added handling for initial messages from devices

## Changelog
### 0.2.3
* (jey-cee) fixed Dead message handler
* (jey-cee) added Subscription to service (only event message handling)
* (jey-cee) when adapter stops Alive state is set to false and sid(subscription id) is cleared

## Changelog
### 0.2.2
* (jey-cee) added listener for Alive/Dead messages from devices
* (jey-cee) if new devices joining the network they will added automatically
* (jey-cee) replace whitespace chars in device id's on creation, because objects and sub-object with whitespace chars wasn't usable


### 0.2.1
* (jey-cee) bug fixing: corrected creation of native's and smaller Bugs


#### 0.2.0
* (jey-cee) getting all xml data from upnp devices

#### 0.1.0
* (jey-cee) initial release

## License
The MIT License (MIT)

Copyright (c) 2016 Jey Cee <jey-cee@live.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
